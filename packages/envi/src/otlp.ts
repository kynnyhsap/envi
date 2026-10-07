// The OTLP settings of the CLI, from the standard OpenTelemetry variables, and the trace context of
// `TRACEPARENT`. Each signal has its own settings: a variable of one signal, such as
// `OTEL_EXPORTER_OTLP_TRACES_HEADERS`, wins over the variable of every signal. A variable that Envi
// cannot use fails the settings of its signal, and only of its signal.
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";

import * as TraceContext from "./core/TraceContext.ts";

/** The kinds of telemetry that Envi sends. Envi has no metrics. */
export const Signal = { Traces: "traces", Logs: "logs" } as const;

export type Signal = (typeof Signal)[keyof typeof Signal];

/** The OTLP protocols over HTTP. Another protocol, such as `grpc`, is a value Envi cannot use. */
export const Protocol = { Protobuf: "http/protobuf", Json: "http/json" } as const;

export type Protocol = (typeof Protocol)[keyof typeof Protocol];

const ProtocolSchema = Schema.Literals([Protocol.Protobuf, Protocol.Json]);

/** Where Envi sends one signal, and how. */
export interface Target {
  readonly url: string;
  readonly protocol: Protocol;
  readonly headers: Readonly<Record<string, string>>;
}

/** A variable that Envi cannot use. It names the variable and never holds its value. */
export class UnusableVariable extends Schema.TaggedError<UnusableVariable>()("UnusableVariable", {
  variable: Schema.String,
}) {}

/** The prefix of the variables of the OTLP exporter. */
const prefix = "OTEL_EXPORTER_OTLP";

/** The name of OTLP in `OTEL_TRACES_EXPORTER` and `OTEL_LOGS_EXPORTER`. */
const otlpExporter = "otlp";

/** The value of `OTEL_SDK_DISABLED` that turns telemetry off, in any case. */
const disabledValue = "true";

/** The URL schemes of OTLP over HTTP. */
const urlSchemes: ReadonlySet<string> = new Set(["http:", "https:"]);

/** The value of a variable. The spec treats an empty value as unset. */
const read = (variable: string) =>
  Effect.map(
    Effect.orElseSucceed(Config.option(Config.String(variable)), () => Option.none<string>()),
    Option.filter((value) => value.trim() !== ""),
  );

const unusable = (variable: string) => new UnusableVariable({ variable });

/** The value of the variable of one signal, or else of the variable of every signal. */
const signalOrCommon = (signal: Signal, setting: string) => {
  const own = `${prefix}_${signal.toUpperCase()}_${setting}`;
  const common = `${prefix}_${setting}`;

  return Effect.flatMap(
    read(own),
    Option.match({
      onSome: (value) => Effect.succeed(Option.some({ variable: own, value })),
      onNone: () =>
        Effect.map(
          read(common),
          Option.map((value) => ({ variable: common, value })),
        ),
    }),
  );
};

const parseUrl = (variable: string, value: string) =>
  Schema.decodeUnknownEffect(Schema.URLFromString)(value.trim()).pipe(
    Effect.filterOrFail((url) => urlSchemes.has(url.protocol)),
    Effect.mapError(() => unusable(variable)),
  );

/** The base URL plus the path of the signal, such as `/v1/traces`. The query of the base stays. */
const withSignalPath = (base: URL, signal: Signal): URL => {
  const url = new URL(base.href);

  url.pathname = `${url.pathname.replace(/\/$/u, "")}/v1/${signal}`;

  return url;
};

/** The URL of one signal. The variable of the signal is the full URL. */
const endpointOf = (signal: Signal) => {
  const own = `${prefix}_${signal.toUpperCase()}_ENDPOINT`;
  const common = `${prefix}_ENDPOINT`;

  const fromCommon = Effect.flatMap(read(common), (base) =>
    Effect.transposeOption(
      Option.map(base, (value) =>
        Effect.map(parseUrl(common, value), (url) => withSignalPath(url, signal)),
      ),
    ),
  );

  return Effect.flatMap(
    read(own),
    Option.match({
      onSome: (value) => Effect.map(parseUrl(own, value), Option.some),
      onNone: () => fromCommon,
    }),
  );
};

const protocolOf = (signal: Signal) =>
  Effect.flatMap(
    signalOrCommon(signal, "PROTOCOL"),
    Option.match({
      onNone: () => Effect.succeed(Protocol.Protobuf),
      onSome: ({ variable, value }) =>
        Effect.mapError(Schema.decodeUnknownEffect(ProtocolSchema)(value.trim()), () =>
          unusable(variable),
        ),
    }),
  );

const decodeComponent = Schema.decodeUnknownEffect(Schema.StringFromUriComponent);

/** One header of `key=value`. The value is the text after the first `=`, so it can hold `=`. */
const headerOf = (variable: string, pair: string) => {
  const at = pair.indexOf("=");

  return Effect.all([
    decodeComponent(pair.slice(0, at).trim()),
    decodeComponent(pair.slice(at + 1).trim()),
  ]).pipe(
    Effect.filterOrFail(([key]) => at > 0 && key !== ""),
    Effect.mapError(() => unusable(variable)),
  );
};

const headersOf = (signal: Signal) =>
  Effect.flatMap(
    signalOrCommon(signal, "HEADERS"),
    Option.match({
      onNone: () => Effect.succeed({}),
      onSome: ({ variable, value }) =>
        Effect.map(
          Effect.forEach(
            value.split(",").filter((pair) => pair.trim() !== ""),
            (pair) => headerOf(variable, pair),
          ),
          Object.fromEntries,
        ),
    }),
  );

/** `false` when the exporter variable of the signal leaves out OTLP, such as with `none`. */
const exportsOtlp = (signal: Signal) =>
  Effect.map(
    read(`OTEL_${signal.toUpperCase()}_EXPORTER`),
    Option.match({
      onNone: () => true,
      onSome: (names) =>
        names
          .split(",")
          .map((name) => name.trim().toLowerCase())
          .includes(otlpExporter),
    }),
  );

/** `OTEL_SDK_DISABLED`. As the spec says, only `true` turns telemetry off. */
const disabled = Effect.map(
  read("OTEL_SDK_DISABLED"),
  Option.exists((value) => value.trim().toLowerCase() === disabledValue),
);

/**
 * Where one signal goes. None when no endpoint is set, when the exporter variable of the signal
 * leaves out OTLP, or when `OTEL_SDK_DISABLED` is `true`.
 */
export const targetOf = (signal: Signal): Effect.Effect<Option.Option<Target>, UnusableVariable> =>
  Effect.gen(function* () {
    if ((yield* disabled) || !(yield* exportsOtlp(signal))) {
      return Option.none();
    }

    const endpoint = yield* endpointOf(signal);

    if (Option.isNone(endpoint)) {
      return Option.none();
    }

    return Option.some({
      url: endpoint.value.href,
      protocol: yield* protocolOf(signal),
      headers: yield* headersOf(signal),
    });
  });

/** The W3C `traceparent` format: version, trace ID, parent span ID, and flags, in lowercase hex. */
const traceParentPattern =
  /^(?<version>[0-9a-f]{2})-(?<traceId>[0-9a-f]{32})-(?<spanId>[0-9a-f]{16})-(?<flags>[0-9a-f]{2})$/u;

const TraceParentGroups = Schema.Struct({
  version: Schema.String,
  traceId: Schema.String,
  spanId: Schema.String,
  flags: Schema.String,
});

/** The version that the W3C spec forbids. */
const forbiddenVersion = "ff";

/** An ID of only zeros is invalid. */
const zeroId = /^0+$/u;

const hexRadix = 16;

/** The bit of the flags that marks a sampled trace. */
const sampledFlag = 1;

const parseTraceParent = (value: string): Option.Option<Tracer.ExternalSpan> =>
  Schema.decodeUnknownOption(TraceParentGroups)(traceParentPattern.exec(value.trim())?.groups).pipe(
    Option.filter(
      (parts) =>
        parts.version !== forbiddenVersion &&
        !zeroId.test(parts.traceId) &&
        !zeroId.test(parts.spanId),
    ),
    Option.map((parts) =>
      Tracer.externalSpan({
        traceId: parts.traceId,
        spanId: parts.spanId,
        sampled: (Number.parseInt(parts.flags, hexRadix) & sampledFlag) === sampledFlag,
      }),
    ),
  );

/**
 * The parent span of the process: the trace context of `TRACEPARENT`, from the parent process.
 * Envi ignores a value that breaks the W3C rules, as the spec says.
 */
export const parentSpan = Effect.map(read(TraceContext.variable), Option.flatMap(parseTraceParent));
