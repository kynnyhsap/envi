// The logs and the traces of the CLI. The logs go to stderr, to the file of `ENVI_LOG_FILE`, and to
// an OTLP collector. The spans go to an OTLP collector. The standard `OTEL_*` variables select the
// collector, so Envi sends to the same collector as the rest of a stack. Telemetry never fails a
// command: a variable that does not parse turns its part off with a warning.
import * as EffectConfig from "effect/Config";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Headers from "effect/http/Headers";
import * as HttpTraceContext from "effect/http/HttpTraceContext";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as LogLevel from "effect/LogLevel";
import * as OtlpExporter from "effect/observability/OtlpExporter";
import * as OtlpLogger from "effect/observability/OtlpLogger";
import * as OtlpSerialization from "effect/observability/OtlpSerialization";
import * as OtlpTracer from "effect/observability/OtlpTracer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";

import * as Package from "./core/Package.ts";
import * as TraceContext from "./core/TraceContext.ts";

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

/** The kinds of telemetry that Envi sends. Envi has no metrics. */
const Signal = { Traces: "traces", Logs: "logs" } as const;

type Signal = (typeof Signal)[keyof typeof Signal];

/**
 * The OTLP protocols over HTTP. Another protocol, such as `grpc`, fails the settings, so Envi sends
 * nothing and warns.
 */
const Protocol = { Protobuf: "http/protobuf", Json: "http/json" } as const;

type Protocol = (typeof Protocol)[keyof typeof Protocol];

const serializations = {
  [Protocol.Protobuf]: OtlpSerialization.layerProtobuf,
  [Protocol.Json]: OtlpSerialization.layerJson,
} satisfies Record<Protocol, Layer.Layer<OtlpSerialization.OtlpSerialization>>;

/** The name of OTLP in `OTEL_TRACES_EXPORTER` and `OTEL_LOGS_EXPORTER`. */
const otlpExporter = "otlp";

/**
 * The longest wait for the last export when Envi exits. A collector that does not answer slows a
 * command down by this time at most.
 */
const shutdownTimeout: Duration.Input = "2 seconds";

/** The lowest level of a log on stderr without `--debug`. */
const consoleLevel: LogLevel.LogLevel = "Info";

/** The URL of the collector for one signal. The variable of the signal wins over the base URL. */
const endpointOf = (signal: Signal) =>
  EffectConfig.option(
    EffectConfig.URL(`OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_ENDPOINT`).pipe(
      EffectConfig.orElse(() =>
        EffectConfig.map(
          EffectConfig.URL("OTEL_EXPORTER_OTLP_ENDPOINT"),
          (base) => new URL(`v1/${signal}`, base.href.endsWith("/") ? base.href : `${base.href}/`),
        ),
      ),
    ),
  );

/** `true` unless the exporter variable of the signal leaves out OTLP, such as with `none`. */
const exportsOtlp = (signal: Signal) =>
  EffectConfig.String(`OTEL_${signal.toUpperCase()}_EXPORTER`).pipe(
    EffectConfig.withDefault(otlpExporter),
    EffectConfig.map((names) =>
      names
        .split(",")
        .map((name) => name.trim().toLowerCase())
        .includes(otlpExporter),
    ),
  );

/** The OTLP settings of the standard variables, with the defaults of the OpenTelemetry spec. */
const otlpSettings = EffectConfig.all({
  disabled: EffectConfig.Boolean("OTEL_SDK_DISABLED").pipe(EffectConfig.withDefault(false)),
  protocol: EffectConfig.Literals(
    [Protocol.Protobuf, Protocol.Json],
    "OTEL_EXPORTER_OTLP_PROTOCOL",
  ).pipe(EffectConfig.withDefault(Protocol.Protobuf)),
  headers: EffectConfig.option(
    EffectConfig.Record(Schema.String, Schema.StringFromUriComponent, "OTEL_EXPORTER_OTLP_HEADERS"),
  ),
  traces: endpointOf(Signal.Traces),
  tracesOn: exportsOtlp(Signal.Traces),
  logs: endpointOf(Signal.Logs),
  logsOn: exportsOtlp(Signal.Logs),
});

/** Where the spans and the logs go, and how Envi encodes them. */
interface Export {
  readonly traces: Option.Option<string>;
  readonly logs: Option.Option<string>;
  readonly headers: Headers.Input | undefined;
  readonly serialization: Layer.Layer<OtlpSerialization.OtlpSerialization>;
}

const noExport: Export = {
  traces: Option.none(),
  logs: Option.none(),
  headers: undefined,
  serialization: OtlpSerialization.layerJson,
};

/** The URL of a signal, while its exporter variable selects OTLP. */
const urlOf = (endpoint: Option.Option<URL>, on: boolean) =>
  on ? Option.map(endpoint, (url) => url.href) : Option.none<string>();

const exportOf = Effect.map(otlpSettings, (settings): Export =>
  settings.disabled
    ? noExport
    : {
        traces: urlOf(settings.traces, settings.tracesOn),
        logs: urlOf(settings.logs, settings.logsOn),
        headers: Option.getOrUndefined(settings.headers),
        serialization: serializations[settings.protocol],
      },
);

/** The value of a setting, or the fallback and a warning when the setting fails. */
const orWarn = <A, E, R>(setting: Effect.Effect<A, E, R>, fallback: A, warning: string) =>
  Effect.match(setting, {
    onSuccess: (value) => ({ value, warning: Option.none<string>() }),
    onFailure: () => ({ value: fallback, warning: Option.some(warning) }),
  });

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

/** The services of an OTLP exporter. */
const exporterLayer = (target: Export) =>
  Layer.mergeAll(target.serialization, FetchHttpClient.layer, OtlpExporter.layerFlusher);

const options = (target: Export, url: string) => ({
  url,
  resource,
  headers: target.headers,
  shutdownTimeout,
});

/** The parent span of the process: the trace context of `TRACEPARENT`, from the parent process. */
const parentSpan = Effect.map(
  Effect.orElseSucceed(EffectConfig.option(EffectConfig.String(TraceContext.variable)), () =>
    Option.none<string>(),
  ),
  Option.flatMap((value) =>
    HttpTraceContext.w3c(Headers.fromInput({ [TraceContext.variable.toLowerCase()]: value })),
  ),
);

/** The flags of the root that select the logs. */
export interface Flags {
  /** `--debug`. It wins over `ENVI_DEBUG`. */
  readonly debug: Option.Option<boolean>;
  readonly logFormat: LogFormat;
}

/**
 * The loggers, the log level, and the tracer of one command. The exporters send their last batch
 * when the layer closes, before the process exits.
 */
export const layer = (flags: Flags) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const debugSetting = yield* orWarn(
        EffectConfig.option(EffectConfig.Boolean(debugVariable)),
        Option.none<boolean>(),
        `${debugVariable} must be true or false. Envi ignores it.`,
      );

      const target = yield* orWarn(
        exportOf,
        noExport,
        "An OTEL_ variable does not parse. Envi sends no telemetry.",
      );

      const logFile = yield* Effect.orElseSucceed(
        EffectConfig.option(EffectConfig.NonEmptyString(logFileVariable)),
        () => Option.none<string>(),
      );

      const fileLogger = yield* Option.match(logFile, {
        onNone: () => Effect.succeed({ value: Option.none(), warning: Option.none<string>() }),
        onSome: (file) =>
          orWarn(
            Effect.map(Logger.toFile(file)(Logger.formatJson), Option.some),
            Option.none(),
            `Envi cannot write the log file of ${logFileVariable}. Envi writes no log file.`,
          ),
      });

      const otlpLogger = yield* Effect.transposeOption(
        Option.map(target.value.logs, (url) =>
          OtlpLogger.make(options(target.value, url)).pipe(
            Effect.provide(exporterLayer(target.value)),
          ),
        ),
      );

      const tracer = yield* Effect.transposeOption(
        Option.map(target.value.traces, (url) =>
          OtlpTracer.make(options(target.value, url)).pipe(
            Effect.provide(exporterLayer(target.value)),
          ),
        ),
      );

      const debug = Option.getOrElse(
        Option.orElse(flags.debug, () => debugSetting.value),
        () => false,
      );

      const loggers = [
        consoleLogger(flags.logFormat, debug),
        Logger.tracerLogger,
        ...Option.toArray(fileLogger.value),
        ...Option.toArray(otlpLogger),
      ];

      // A sink other than stderr receives every debug log.
      const exports = Option.isSome(fileLogger.value) || Option.isSome(otlpLogger);

      const minimum: LogLevel.LogLevel =
        debug || exports || Option.isSome(tracer) ? "Debug" : "Info";

      yield* Effect.forEach(
        [debugSetting.warning, target.warning, fileLogger.warning].flatMap(Option.toArray),
        (warning) => Effect.logWarning(warning),
      ).pipe(Effect.provideService(Logger.CurrentLoggers, new Set(loggers)));

      return Layer.mergeAll(
        Logger.layer(loggers),
        Layer.succeed(References.MinimumLogLevel, minimum),
        Layer.succeed(TraceContext.Propagate, Option.isSome(tracer)),
        Option.match(tracer, {
          onNone: () => Layer.empty,
          onSome: (value) => Layer.succeed(Tracer.Tracer, value),
        }),
        Option.match(yield* parentSpan, {
          onNone: () => Layer.empty,
          onSome: (span) => Layer.parentSpan(span),
        }),
      );
    }),
  );
