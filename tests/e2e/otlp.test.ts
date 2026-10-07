// The OTLP settings of the CLI: the variables of each signal, the endpoint URL, `OTEL_SDK_DISABLED`,
// a bad `TRACEPARENT`, a bad variable, and a collector that never answers. A small OTLP collector
// in the test process records each request that the CLI sends.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import {
  collector,
  exportTo,
  type Received,
  silentCollector,
  slowCollector,
  spansOf,
} from "./collector.ts";
import { exportJson, fixture, makeSandbox, runtimes } from "./helpers.ts";

const app = fixture("cached");

const pathsOf = (received: ReadonlyArray<Received>) =>
  [...new Set(received.map((request) => request.path))].toSorted();

const requestsOn = (received: ReadonlyArray<Received>, path: string) =>
  received.filter((request) => request.path === path);

/** The trace ID and the span ID of a parent process. */
const parentTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";

const parentSpanId = "00f067aa0ba902b7";

/** The longest delay of the exit by a collector that never answers, as the docs say. */
const shutdownLimit = Duration.seconds(2);

/** An answer of a healthy collector that comes before the shutdown limit. */
const slowAnswer = Duration.millis(1500);

/** The slack for the start of the runtime and the load of the machine. */
const slack = Duration.seconds(1);

layer(NodeServices.layer, { excludeTestServices: true })("envi OTLP settings", (it) => {
  describe.each(runtimes)("on %s", (runtime) => {
    it.effect("sends each signal with the protocol and the headers of the signal", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const { url, received } = yield* collector;
        const token = "Bearer token==";
        const team = "my-team";

        const result = yield* exportJson(runtime, app, sandbox, {
          OTEL_EXPORTER_OTLP_ENDPOINT: url,
          OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
          OTEL_EXPORTER_OTLP_HEADERS: `x-team=${team}`,
          OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/protobuf",
          OTEL_EXPORTER_OTLP_TRACES_HEADERS: `authorization=${encodeURIComponent(token)}`,
        });

        const traces = requestsOn(received, "/v1/traces");
        const logs = requestsOn(received, "/v1/logs");

        expect(result.exitCode).toBe(0);
        expect(traces.length).toBeGreaterThan(0);
        expect(logs.length).toBeGreaterThan(0);
        expect(traces.map((request) => request.contentType)).toEqual(
          traces.map(() => "application/x-protobuf"),
        );
        expect(traces.map((request) => request.headers["authorization"])).toEqual(
          traces.map(() => [token]),
        );
        expect(traces.map((request) => request.headers["x-team"])).toEqual(
          traces.map(() => undefined),
        );
        expect(logs.map((request) => request.contentType)).toEqual(
          logs.map(() => "application/json"),
        );
        expect(logs.map((request) => request.headers["x-team"])).toEqual(logs.map(() => [team]));
      }),
    );

    it.effect("adds the path of each signal to a base URL with a path and a query", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const { url, received } = yield* collector;
        const base = "/collector";
        const query = "?api=marker";

        const result = yield* exportJson(runtime, app, sandbox, {
          OTEL_EXPORTER_OTLP_ENDPOINT: `${url}${base}/${query}`,
        });

        expect(result.exitCode).toBe(0);
        expect(pathsOf(received)).toEqual([`${base}/v1/logs${query}`, `${base}/v1/traces${query}`]);
      }),
    );

    it.effect("turns off a signal whose endpoint is not a URL, and names the variable", () =>
      Effect.gen(function* () {
        const { url, received } = yield* collector;
        const variable = "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT";
        const value = "not-a-collector-url";

        const result = yield* exportJson(runtime, app, yield* makeSandbox("none"), {
          OTEL_EXPORTER_OTLP_ENDPOINT: url,
          [variable]: value,
        });

        const plain = yield* exportJson(runtime, app, yield* makeSandbox("none"));

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(plain.stdout);
        expect(pathsOf(received)).toEqual(["/v1/logs"]);
        expect(result.stderr).toContain(variable);
        expect(result.stderr).not.toContain(value);
      }),
    );

    it.effect(
      "sends nothing when OTEL_SDK_DISABLED is true in any case, and sends with FALSE",
      () =>
        Effect.gen(function* () {
          const off = yield* collector;
          const on = yield* collector;

          yield* exportJson(runtime, app, yield* makeSandbox("none"), {
            OTEL_EXPORTER_OTLP_ENDPOINT: off.url,
            OTEL_SDK_DISABLED: "TRUE",
          });

          const result = yield* exportJson(runtime, app, yield* makeSandbox("none"), {
            OTEL_EXPORTER_OTLP_ENDPOINT: on.url,
            OTEL_SDK_DISABLED: "FALSE",
          });

          expect(off.received).toEqual([]);
          expect(pathsOf(on.received)).toEqual(["/v1/logs", "/v1/traces"]);
          expect(result.stderr).toBe("");
        }),
    );

    it.effect("starts a new trace when TRACEPARENT breaks the W3C rules", () =>
      Effect.gen(function* () {
        const zeroTrace = `00-${"0".repeat(parentTraceId.length)}-${parentSpanId}-01`;
        const badFlags = `00-${parentTraceId}-${parentSpanId}-zz`;

        const roots = yield* Effect.forEach([zeroTrace, badFlags], (traceparent) =>
          Effect.gen(function* () {
            const { url, received } = yield* collector;

            yield* exportJson(runtime, app, yield* makeSandbox("none"), {
              ...exportTo(url),
              TRACEPARENT: traceparent,
            });

            return (yield* spansOf(received)).find((span) => span.name === "envi export");
          }),
        );

        for (const root of roots) {
          expect(root?.parentSpanId).toBeUndefined();
          expect(root?.traceId).not.toBe(parentTraceId);
          expect(root?.traceId).not.toMatch(/^0+$/u);
        }
      }),
    );

    it.effect("continues the trace of a TRACEPARENT of a later version with more fields", () =>
      Effect.gen(function* () {
        const { url, received } = yield* collector;

        yield* exportJson(runtime, app, yield* makeSandbox("none"), {
          ...exportTo(url),
          TRACEPARENT: `01-${parentTraceId}-${parentSpanId}-01-more`,
        });

        const root = (yield* spansOf(received)).find((span) => span.name === "envi export");

        expect(root?.traceId).toBe(parentTraceId);
        expect(root?.parentSpanId).toBe(parentSpanId);
      }),
    );

    it.effect("ignores a bad ENVI_DEBUG when --debug decides", () =>
      Effect.gen(function* () {
        const variable = "ENVI_DEBUG";
        const env = { [variable]: "sometimes" };

        const decided = yield* exportJson(runtime, app, yield* makeSandbox("none"), env, [
          "--debug=false",
        ]);

        const undecided = yield* exportJson(runtime, app, yield* makeSandbox("none"), env);

        expect(decided.exitCode).toBe(0);
        expect(decided.stderr).toBe("");
        expect(undecided.stderr).toContain(variable);
      }),
    );

    it.effect("runs the command when OTEL_RESOURCE_ATTRIBUTES does not parse", () =>
      Effect.gen(function* () {
        const { url, received } = yield* collector;

        const result = yield* exportJson(runtime, app, yield* makeSandbox("none"), {
          ...exportTo(url),
          OTEL_RESOURCE_ATTRIBUTES: "team=%ZZ",
        });

        const plain = yield* exportJson(runtime, app, yield* makeSandbox("none"));

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(plain.stdout);
        expect(result.stderr).toContain("Envi cannot start the export of the traces.");
        expect(received).toEqual([]);
      }),
    );

    it.effect("exits within the shutdown limit when the collector never answers", () =>
      Effect.gen(function* () {
        const { url, received } = yield* silentCollector;

        const plainStart = yield* Clock.currentTimeMillis;
        const plain = yield* exportJson(runtime, app, yield* makeSandbox("none"));
        const tracedStart = yield* Clock.currentTimeMillis;
        const traced = yield* exportJson(runtime, app, yield* makeSandbox("none"), exportTo(url));
        const end = yield* Clock.currentTimeMillis;

        const delay = end - tracedStart - (tracedStart - plainStart);

        expect(traced.exitCode).toBe(0);
        expect(traced.stdout).toBe(plain.stdout);
        expect(traced.stderr).toBe(plain.stderr);
        expect(received.length).toBeGreaterThan(0);
        expect(delay).toBeLessThan(Duration.toMillis(Duration.sum(shutdownLimit, slack)));
      }),
    );

    it.effect("waits for a slow collector that answers within the shutdown limit", () =>
      Effect.gen(function* () {
        const { url, received, answered } = yield* slowCollector(slowAnswer);

        const result = yield* exportJson(runtime, app, yield* makeSandbox("none"), exportTo(url));

        expect(result.exitCode).toBe(0);
        expect(pathsOf(received)).toEqual(["/v1/logs", "/v1/traces"]);
        expect(answered.toSorted()).toEqual(received.map((request) => request.path).toSorted());
      }),
    );
  });
});
