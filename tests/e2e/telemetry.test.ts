// The logs and the traces of the CLI: the OTLP export, the trace context of a parent and a child,
// `ENVI_DEBUG`, and `ENVI_LOG_FILE`. A small OTLP collector in the test process records each
// request that the CLI sends.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { createServer } from "node:http";

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

interface Received {
  readonly path: string;
  readonly contentType: string;
  readonly body: string;
}

/** The address of a server that listens on a TCP port. */
const Address = Schema.Struct({ port: Schema.Number });

/** An OTLP collector on a free port. It answers every request with an empty success. */
const collector = Effect.acquireRelease(
  Effect.callback<
    { readonly url: string; readonly received: Array<Received>; close: () => void },
    Schema.SchemaError
  >((resume) => {
    const received: Array<Received> = [];

    const server = createServer((request, response) => {
      const chunks: Array<Buffer> = [];

      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push({
          path: request.url ?? "",
          contentType: request.headers["content-type"] ?? "",
          body: Buffer.concat(chunks).toString("utf8"),
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
    });

    server.listen(0, "127.0.0.1", () => {
      resume(
        Effect.map(Schema.decodeUnknownEffect(Address)(server.address()), ({ port }) => ({
          url: `http://127.0.0.1:${port}`,
          received,
          close: () => {
            server.closeAllConnections();
            server.close();
          },
        })),
      );
    });
  }),
  (server) => Effect.sync(server.close),
);

const AnyValue = Schema.Struct({
  stringValue: Schema.optional(Schema.String),
  intValue: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
});

const Attribute = Schema.Struct({ key: Schema.String, value: AnyValue });

const Resource = Schema.Struct({ attributes: Schema.Array(Attribute) });

const Span = Schema.Struct({
  traceId: Schema.String,
  spanId: Schema.String,
  parentSpanId: Schema.optional(Schema.String),
  name: Schema.String,
  attributes: Schema.Array(Attribute),
  status: Schema.Struct({ code: Schema.Number }),
});

const Traces = Schema.fromJsonString(
  Schema.Struct({
    resourceSpans: Schema.Array(
      Schema.Struct({
        resource: Resource,
        scopeSpans: Schema.Array(Schema.Struct({ spans: Schema.Array(Span) })),
      }),
    ),
  }),
);

const LogRecord = Schema.Struct({
  body: AnyValue,
  traceId: Schema.optional(Schema.String),
  severityText: Schema.String,
});

const Logs = Schema.fromJsonString(
  Schema.Struct({
    resourceLogs: Schema.Array(
      Schema.Struct({
        resource: Resource,
        scopeLogs: Schema.Array(Schema.Struct({ logRecords: Schema.Array(LogRecord) })),
      }),
    ),
  }),
);

/** The JSON bodies that the collector received on one path. */
const bodiesOn = (received: ReadonlyArray<Received>, path: string) =>
  received.flatMap((request) => (request.path === path ? [request.body] : []));

/** Every span of every traces request, with the attributes of its resource. */
const spansOf = (received: ReadonlyArray<Received>) =>
  Effect.map(
    Effect.forEach(bodiesOn(received, "/v1/traces"), (body) => Schema.decodeEffect(Traces)(body)),
    (requests) =>
      requests.flatMap((request) =>
        request.resourceSpans.flatMap((resource) =>
          resource.scopeSpans.flatMap((scope) =>
            scope.spans.map((span) => ({ ...span, resource: resource.resource.attributes })),
          ),
        ),
      ),
  );

/** Every log record of every logs request. */
const logsOf = (received: ReadonlyArray<Received>) =>
  Effect.map(
    Effect.forEach(bodiesOn(received, "/v1/logs"), (body) => Schema.decodeEffect(Logs)(body)),
    (requests) =>
      requests.flatMap((request) =>
        request.resourceLogs.flatMap((resource) =>
          resource.scopeLogs.flatMap((scope) => scope.logRecords),
        ),
      ),
  );

const valueOf = (attributes: ReadonlyArray<typeof Attribute.Type>, key: string) =>
  attributes.find((attribute) => attribute.key === key)?.value.stringValue;

/** The variables that point the CLI at the collector, with the JSON protocol. */
const exportTo = (url: string) => ({
  OTEL_EXPORTER_OTLP_ENDPOINT: url,
  OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
});

/** No request body holds a secret value. The bodies of protobuf hold their strings as UTF-8. */
const holdsNoSecret = (received: ReadonlyArray<Received>) =>
  received.every((request) => hiddenSecrets.every((secret) => !request.body.includes(secret)));

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
