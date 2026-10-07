// The logs and the traces of the CLI: the OTLP export, the trace context of a parent and a child,
// `ENVI_DEBUG`, `ENVI_LOG_FILE`, and the secrets that telemetry must never hold. A small OTLP
// collector in the test process records each request that the CLI sends.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  bodiesOn,
  collector,
  exportTo,
  holdsNoSecret,
  logsOf,
  spansOf,
  valueOf,
} from "./collector.ts";
import {
  enviVersion,
  exportJson,
  fixture,
  hiddenSecrets,
  makeSandbox,
  runCli,
  runtimes,
  secrets,
} from "./helpers.ts";

const app = fixture("cached");

const leaky = fixture("telemetry");

/** A trace context of a parent process, in the W3C `traceparent` format. */
const parentTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";

const parentSpanId = "00f067aa0ba902b7";

const traceparent = `00-${parentTraceId}-${parentSpanId}-01`;

const debugLine = /level=DEBUG/u;

layer(NodeServices.layer, { excludeTestServices: true })("envi telemetry", (it) => {
  describe.each(runtimes)("on %s", (runtime) => {
    it.effect("sends the spans and the logs of a command to an OTLP collector", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const { url, received } = yield* collector;
        const traced = yield* exportJson(runtime, app, sandbox, exportTo(url));
        const plain = yield* exportJson(runtime, app, yield* makeSandbox("none"));

        expect(traced.exitCode).toBe(0);
        expect(traced.stdout).toBe(plain.stdout);
        expect(traced.stderr).not.toMatch(debugLine);

        const spans = yield* spansOf(received);
        const names = spans.map((span) => span.name);
        const [root, ...others] = spans.filter((span) => span.parentSpanId === undefined);

        expect(names).toEqual(
          expect.arrayContaining([
            "envi export",
            "config.import",
            "provider.resolve",
            "custom.resolve",
          ]),
        );
        expect(root?.name).toBe("envi export");
        expect(others).toEqual([]);
        expect(spans.every((span) => span.traceId === root?.traceId)).toBe(true);
        expect(valueOf(root?.resource ?? [], "service.name")).toBe("envi");
        expect(valueOf(root?.resource ?? [], "service.version")).toBe(enviVersion);

        const logs = yield* logsOf(received);

        const batch = logs.find(
          (log) => log.body.stringValue === "Envi calls a provider with one batch.",
        );

        expect(batch?.traceId).toBe(root?.traceId);
        expect(holdsNoSecret(received)).toBe(true);
      }),
    );

    it.effect("sends protobuf without a protocol, and no secret", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const { url, received } = yield* collector;

        const result = yield* exportJson(runtime, app, sandbox, {
          OTEL_EXPORTER_OTLP_ENDPOINT: url,
        });

        expect(result.exitCode).toBe(0);
        expect(bodiesOn(received, "/v1/traces").length).toBeGreaterThan(0);
        expect(received.every((request) => request.contentType === "application/x-protobuf")).toBe(
          true,
        );
        expect(holdsNoSecret(received)).toBe(true);
      }),
    );

    it.effect("keeps the message of a throw in user code out of the spans and the logs", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const { url, received } = yield* collector;

        const result = yield* runCli(runtime, leaky, ["check", "--debug"], {
          ...sandbox.env,
          ...exportTo(url),
        });

        const spans = yield* spansOf(received);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toMatch(debugLine);
        // The span of the failed `custom()` holds the failure, as an error status.
        expect(spans.some((span) => span.name === "custom.resolve" && span.status.code === 2)).toBe(
          true,
        );
        expect(received.every((request) => !request.body.includes(secrets["db-password"]))).toBe(
          true,
        );
        expect(result.stderr).not.toContain(secrets["db-password"]);
      }),
    );

    it.effect(
      "keeps an error or a URL of a span, an event, or a link in user code out of the spans",
      () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const { url, received } = yield* collector;

          const result = yield* runCli(runtime, leaky, ["check"], {
            ...sandbox.env,
            ...exportTo(url),
          });

          const spans = yield* spansOf(received);

          expect(result.exitCode).toBe(1);
          // The span of the config ends before Envi maps the error, with an error status.
          expect(spans.some((span) => span.name === "exchange" && span.status.code === 2)).toBe(
            true,
          );
          expect(received.every((request) => !request.body.includes(secrets["db-password"]))).toBe(
            true,
          );
        }),
    );

    it.effect("keeps the URL of an HTTP request in user code out of the spans, and traces it", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const { url, received } = yield* collector;

        const result = yield* runCli(runtime, leaky, ["check"], {
          ...sandbox.env,
          ...exportTo(url),
          ENVI_E2E_HTTP_URL: url,
        });

        const spans = yield* spansOf(received);
        const root = spans.find((span) => span.name === "envi check");

        const http = spans.find(
          (span) => valueOf(span.attributes, "http.request.method") === "GET",
        );

        const request = received.find((sent) => sent.path.startsWith("/?key="));
        const [, traceId] = request?.headers["traceparent"]?.[0]?.split("-") ?? [];

        expect(result.exitCode).toBe(1);
        const keys = http?.attributes.map((attribute) => attribute.key) ?? [];

        expect(keys).toContain("http.request.method");
        expect(keys).not.toContain("url.full");
        expect(keys).not.toContain("url.query");
        // The server of the request continues the trace of the command.
        expect(traceId).toBe(root?.traceId);
        expect(
          received
            .filter((sent) => sent !== request)
            .every((sent) => !sent.body.includes(secrets["db-password"])),
        ).toBe(true);
      }),
    );

    it.effect("keeps an error of a log in user code off stderr and out of the logs", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sandbox = yield* makeSandbox("none");
        const { url, received } = yield* collector;
        const logFile = path.join(sandbox.directory, "envi.log");

        const result = yield* runCli(runtime, leaky, ["check"], {
          ...sandbox.env,
          ...exportTo(url),
          ENVI_LOG_FILE: logFile,
        });

        const logs = yield* logsOf(received);

        // An annotation named `_tag` is plain data, and the other annotations stay.
        const ready = result.stderr
          .split("\n")
          .find((line) => line.includes("The count is ready."));

        expect(result.stderr).toContain("The exchange failed.");
        expect(result.stderr).toContain("The retry failed.");
        expect(result.stderr).toContain("The call failed.");

        expect(ready).toContain("_tag=Ready");
        expect(ready).toContain("count=3");
        expect(result.stderr).not.toContain(secrets["db-password"]);
        expect(yield* fs.readFileString(logFile)).not.toContain(secrets["db-password"]);
        expect(logs.some((log) => log.body.stringValue === "The exchange failed.")).toBe(true);
        expect(received.every((request) => !request.body.includes(secrets["db-password"]))).toBe(
          true,
        );
      }),
    );

    it.effect("keeps the arguments of a command that run cannot start out of the spans", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const { url, received } = yield* collector;
        const argument = "argument-of-the-command";

        const result = yield* runCli(
          runtime,
          app,
          ["run", "--cache-dir", sandbox.cacheDirectory, "--", "envi-missing-command", argument],
          { ...sandbox.env, ...exportTo(url) },
        );

        const spans = yield* spansOf(received);

        expect(result.exitCode).not.toBe(0);
        expect(spans.some((span) => span.name === "envi run" && span.status.code === 2)).toBe(true);
        expect(received.every((request) => !request.body.includes(argument))).toBe(true);
      }),
    );

    it.effect("continues the trace of TRACEPARENT, and passes the trace to the child of run", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const { url, received } = yield* collector;

        const result = yield* runCli(
          runtime,
          app,
          [
            "run",
            "--cache-dir",
            sandbox.cacheDirectory,
            "--",
            "node",
            "-e",
            "process.stdout.write(process.env.TRACEPARENT ?? '')",
          ],
          { ...sandbox.env, ...exportTo(url), TRACEPARENT: traceparent },
        );

        const spans = yield* spansOf(received);
        const root = spans.find((span) => span.name === "envi run");
        const [version, traceId, spanId, flags] = result.stdout.trim().split("-");

        expect(result.exitCode).toBe(0);
        expect(root?.traceId).toBe(parentTraceId);
        expect(root?.parentSpanId).toBe(parentSpanId);
        expect([version, traceId, flags]).toEqual(["00", parentTraceId, "01"]);
        // The child continues the trace under a span of this run.
        expect(spans.map((span) => span.spanId)).toContain(spanId);
      }),
    );

    it.effect("passes the TRACEPARENT of its parent to the child of run without an export", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");

        const result = yield* runCli(
          runtime,
          app,
          [
            "run",
            "--cache-dir",
            sandbox.cacheDirectory,
            "--",
            "node",
            "-e",
            "process.stdout.write(process.env.TRACEPARENT ?? '')",
          ],
          { ...sandbox.env, TRACEPARENT: traceparent },
        );

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(traceparent);
      }),
    );

    it.effect("runs the command when the collector does not answer", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        // A port that nothing listens on: the collector closes before the run.
        const closed = yield* Effect.scoped(Effect.map(collector, (server) => server.url));

        const traced = yield* exportJson(runtime, app, sandbox, exportTo(closed));
        const plain = yield* exportJson(runtime, app, yield* makeSandbox("none"));

        expect(traced.exitCode).toBe(0);
        expect(traced.stdout).toBe(plain.stdout);
        expect(traced.stderr).toBe(plain.stderr);
      }),
    );

    it.effect("prints the debug logs with ENVI_DEBUG, and --debug=false wins over it", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const debug = { ENVI_DEBUG: "true" };

        const byVariable = yield* exportJson(runtime, app, sandbox, debug);
        const byFlag = yield* exportJson(runtime, app, sandbox, debug, ["--debug=false"]);
        const plain = yield* exportJson(runtime, app, sandbox);

        expect(byVariable.exitCode).toBe(0);
        expect(byVariable.stderr).toMatch(/step=command durationMs=\d+ outcome=success/u);
        expect(byFlag.stderr).not.toMatch(debugLine);
        expect(plain.stderr).not.toMatch(debugLine);
      }),
    );

    it.effect("writes the logs to the file of ENVI_LOG_FILE as JSON lines", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sandbox = yield* makeSandbox("none");
        const logFile = path.join(sandbox.directory, "envi.log");

        const first = yield* exportJson(runtime, app, sandbox, { ENVI_LOG_FILE: logFile });
        const second = yield* exportJson(runtime, app, sandbox, { ENVI_LOG_FILE: logFile });

        const lines = (yield* fs.readFileString(logFile)).split("\n").filter((line) => line !== "");

        const commands = yield* Effect.forEach(lines, (line) =>
          Schema.decodeEffect(
            Schema.fromJsonString(
              Schema.Struct({
                level: Schema.String,
                annotations: Schema.Record(Schema.String, Schema.Unknown),
              }),
            ),
          )(line),
        );

        expect(first.exitCode).toBe(0);
        expect(first.stderr).not.toMatch(debugLine);
        // Each run appends its own lines: one timing line of the command for each run.
        expect(
          commands.filter((log) => log.level === "DEBUG" && log.annotations["step"] === "command")
            .length,
        ).toBe(2);
        expect(second.stdout).toBe(first.stdout);
        expect(hiddenSecrets.every((secret) => lines.every((line) => !line.includes(secret)))).toBe(
          true,
        );
      }),
    );
  });
});
