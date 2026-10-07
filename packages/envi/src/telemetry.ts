// The logs and the traces of the CLI. The logs go to stderr, to the file of `ENVI_LOG_FILE`, and to
// an OTLP collector. The spans go to an OTLP collector. The standard `OTEL_*` variables select the
// collector, so Envi sends to the same collector as the rest of a stack. Telemetry never fails a
// command: a part that fails to start turns off with a warning.
import * as Cause from "effect/Cause";
import * as EffectConfig from "effect/Config";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as LogLevel from "effect/LogLevel";
import * as OtlpExporter from "effect/observability/OtlpExporter";
import * as OtlpLogger from "effect/observability/OtlpLogger";
import * as OtlpSerialization from "effect/observability/OtlpSerialization";
import * as OtlpTracer from "effect/observability/OtlpTracer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Tracer from "effect/Tracer";

import * as Package from "./core/Package.ts";
import * as TraceContext from "./core/TraceContext.ts";
import * as Otlp from "./otlp.ts";
import { safeLogger, safeTracer } from "./redaction.ts";

/** The formats of the logs on stderr. */
export const LogFormat = { Pretty: "pretty", Json: "json" } as const;

export type LogFormat = (typeof LogFormat)[keyof typeof LogFormat];

const formatters = {
  [LogFormat.Pretty]: Logger.formatLogFmt,
  [LogFormat.Json]: Logger.formatJson,
};

/** The variable that shows the debug logs on stderr, as `--debug` does. */
const debugVariable = "ENVI_DEBUG";

/** The variable of a file that receives every log, as JSON lines. */
const logFileVariable = "ENVI_LOG_FILE";

const serializations = {
  [Otlp.Protocol.Protobuf]: OtlpSerialization.layerProtobuf,
  [Otlp.Protocol.Json]: OtlpSerialization.layerJson,
} satisfies Record<Otlp.Protocol, Layer.Layer<OtlpSerialization.OtlpSerialization>>;

/**
 * The longest wait for the last export when Envi exits. One flush sends the last batch of both
 * signals at once, so a collector that does not answer delays the exit by this time at most.
 */
const flushTimeout: Duration.Input = "2 seconds";

/**
 * The wait of each exporter when its scope closes. The flush has already sent its last batch, so
 * the exporter does not wait again.
 */
const shutdownTimeout: Duration.Input = "0 millis";

/** The lowest level of a log on stderr without `--debug`. */
const consoleLevel: LogLevel.LogLevel = "Info";

/** Every log goes to stderr with `--debug`. Without it, only a log of `Info` or above does. */
const consoleLogger = (format: LogFormat, debug: boolean): Logger.Logger<unknown, void> => {
  const logger = Logger.withConsoleError(formatters[format]);

  return debug
    ? logger
    : Logger.make((options) => {
        if (LogLevel.isGreaterThanOrEqualTo(options.logLevel, consoleLevel)) {
          logger.log(options);
        }
      });
};

/** The resource of every span and every log: the service `envi` and its version. */
const resource = { serviceName: Package.command, serviceVersion: Package.version };

/** A part of telemetry and the warning of its failure. */
interface Part<A> {
  readonly value: A;
  readonly warning: Option.Option<string>;
}

/**
 * The value of a part, or the fallback and a warning when the part fails or dies. Effect reads
 * `OTEL_RESOURCE_ATTRIBUTES` when an exporter starts, and a bad value dies there.
 */
const guard = <A, E, R>(
  part: Effect.Effect<A, E, R>,
  fallback: A,
  warning: (cause: Cause.Cause<E>) => string,
): Effect.Effect<Part<A>, never, R> =>
  Effect.matchCause(part, {
    onSuccess: (value) => ({ value, warning: Option.none() }),
    onFailure: (cause) => ({ value: fallback, warning: Option.some(warning(cause)) }),
  });

/** The warning of a signal that does not start. It names the variable, never its value. */
const signalWarning = (signal: Otlp.Signal) => (cause: Cause.Cause<Otlp.UnusableVariable>) =>
  Option.match(Cause.findErrorOption(cause), {
    onSome: (error) => `Envi cannot use ${error.variable}. Envi sends no ${signal}.`,
    onNone: () => `Envi cannot start the export of the ${signal}. Envi sends no ${signal}.`,
  });

/** The options of `OtlpTracer.make` and `OtlpLogger.make` that Envi sets. */
interface ExporterOptions {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly resource: typeof resource;
  readonly shutdownTimeout: Duration.Input;
}

/** The services that both exporters share. One flusher sends the last batch of both at once. */
type ExporterServices = Context.Context<HttpClient.HttpClient | OtlpExporter.Flusher>;

/** Starts the exporter of one signal, when the settings of the signal name a collector. */
const exporterOf = <A, R>(
  services: ExporterServices,
  signal: Otlp.Signal,
  make: (options: ExporterOptions) => Effect.Effect<A, never, R>,
) =>
  guard(
    Effect.flatMap(Otlp.targetOf(signal), (target) =>
      Effect.transposeOption(
        Option.map(target, (value) =>
          make({ url: value.url, headers: value.headers, resource, shutdownTimeout }).pipe(
            Effect.provide(serializations[value.protocol]),
            Effect.provide(services),
          ),
        ),
      ),
    ),
    Option.none<A>(),
    signalWarning(signal),
  );

/** Sends the last batch of both signals when the layer closes, within one deadline. */
const flushOnClose = (services: ExporterServices) =>
  Effect.addFinalizer(() =>
    Effect.asVoid(
      Effect.timeoutOption(Context.get(services, OtlpExporter.Flusher).flush, flushTimeout),
    ),
  );

const noFileLogger: Part<Option.Option<Logger.Logger<unknown, void>>> = {
  value: Option.none(),
  warning: Option.none(),
};

/** The file logger of `ENVI_LOG_FILE`. */
const fileLoggerOf = Effect.flatMap(
  Effect.orElseSucceed(EffectConfig.option(EffectConfig.NonEmptyString(logFileVariable)), () =>
    Option.none<string>(),
  ),
  Option.match({
    onNone: () => Effect.succeed(noFileLogger),
    onSome: (file) =>
      guard(
        Effect.map(Logger.toFile(file)(Logger.formatJson), Option.some),
        Option.none(),
        () => `Envi cannot write the log file of ${logFileVariable}. Envi writes no log file.`,
      ),
  }),
);

/** The flags of the root that select the logs. */
export interface Flags {
  /** `--debug`. It wins over `ENVI_DEBUG`. */
  readonly debug: Option.Option<boolean>;
  readonly logFormat: LogFormat;
}

/** `--debug`, then `ENVI_DEBUG`, then off. Envi reads the variable only when the flag is unset. */
const debugOf = (flags: Flags): Effect.Effect<Part<boolean>> =>
  Option.match(flags.debug, {
    onSome: (value) => Effect.succeed({ value, warning: Option.none() }),
    onNone: () =>
      Effect.map(
        guard(
          EffectConfig.option(EffectConfig.Boolean(debugVariable)),
          Option.none<boolean>(),
          () => `${debugVariable} must be true or false. Envi ignores it.`,
        ),
        (setting) => ({
          value: Option.getOrElse(setting.value, () => false),
          warning: setting.warning,
        }),
      ),
  });

/**
 * The loggers, the log level, and the tracer of one command. The exporters send their last batch
 * when the layer closes, before the process exits.
 */
export const layer = (flags: Flags) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const debug = yield* debugOf(flags);
      const fileLogger = yield* fileLoggerOf;

      const services = yield* Layer.build(
        Layer.mergeAll(FetchHttpClient.layer, OtlpExporter.layerFlusher),
      );

      const otlpLogger = yield* exporterOf(services, Otlp.Signal.Logs, OtlpLogger.make);
      const tracer = yield* exporterOf(services, Otlp.Signal.Traces, OtlpTracer.make);

      // Added after the exporters, so it runs before their own finalizers.
      yield* flushOnClose(services);

      // Every logger gets a safe cause, so a log never shows the text of an unknown error.
      const loggers = [
        safeLogger(consoleLogger(flags.logFormat, debug.value)),
        safeLogger(Logger.tracerLogger),
        ...Option.toArray(Option.map(fileLogger.value, safeLogger)),
        ...Option.toArray(Option.map(otlpLogger.value, safeLogger)),
      ];

      // A sink other than stderr receives every debug log.
      const sinks =
        Option.isSome(fileLogger.value) ||
        Option.isSome(otlpLogger.value) ||
        Option.isSome(tracer.value);

      const minimum: LogLevel.LogLevel = debug.value || sinks ? "Debug" : "Info";

      yield* Effect.forEach(
        [debug, fileLogger, otlpLogger, tracer].flatMap((part) => Option.toArray(part.warning)),
        (warning) => Effect.logWarning(warning),
      ).pipe(Effect.provideService(Logger.CurrentLoggers, new Set(loggers)));

      return Layer.mergeAll(
        Logger.layer(loggers),
        Layer.succeed(References.MinimumLogLevel, minimum),
        Layer.succeed(TraceContext.Propagate, Option.isSome(tracer.value)),
        // The span of an HTTP request holds its URL, and a URL can hold a secret.
        Layer.succeed(HttpClient.TracerDisabledWhen, () => true),
        Option.match(tracer.value, {
          onNone: () => Layer.empty,
          onSome: (value) => Layer.succeed(Tracer.Tracer, safeTracer(value)),
        }),
        Option.match(yield* Otlp.parentSpan, {
          onNone: () => Layer.empty,
          onSome: (span) => Layer.parentSpan(span),
        }),
      );
    }),
  );
