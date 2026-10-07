// A small OTLP collector for the end-to-end tests. It runs in the test process and records each
// request that the CLI sends, and it decodes the JSON bodies of the traces and the logs.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { createServer } from "node:http";

import { hiddenSecrets } from "./helpers.ts";

/** One request that the collector received. */
export interface Received {
  readonly path: string;
  readonly contentType: string;
  readonly headers: Readonly<Partial<Record<string, ReadonlyArray<string>>>>;
  readonly body: string;
}

/** The address of a server that listens on a TCP port. */
const Address = Schema.Struct({ port: Schema.Number });

/**
 * An OTLP collector on a free port. It records each request. With `answer: false`, it accepts each
 * request and never answers, as a collector that hangs.
 */
const collectorWith = (options: { readonly answer: boolean }) =>
  Effect.acquireRelease(
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
            headers: request.headersDistinct,
            body: Buffer.concat(chunks).toString("utf8"),
          });

          if (options.answer) {
            response.writeHead(200, { "content-type": "application/json" });
            response.end("{}");
          }
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

/** A collector that answers every request with an empty success. */
export const collector = collectorWith({ answer: true });

/** A collector that accepts every request and never answers. */
export const silentCollector = collectorWith({ answer: false });

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
export const bodiesOn = (received: ReadonlyArray<Received>, path: string) =>
  received.flatMap((request) => (request.path === path ? [request.body] : []));

/** Every span of every traces request, with the attributes of its resource. */
export const spansOf = (received: ReadonlyArray<Received>) =>
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
export const logsOf = (received: ReadonlyArray<Received>) =>
  Effect.map(
    Effect.forEach(bodiesOn(received, "/v1/logs"), (body) => Schema.decodeEffect(Logs)(body)),
    (requests) =>
      requests.flatMap((request) =>
        request.resourceLogs.flatMap((resource) =>
          resource.scopeLogs.flatMap((scope) => scope.logRecords),
        ),
      ),
  );

export const valueOf = (attributes: ReadonlyArray<typeof Attribute.Type>, key: string) =>
  attributes.find((attribute) => attribute.key === key)?.value.stringValue;

/** The variables that point the CLI at the collector, with the JSON protocol. */
export const exportTo = (url: string) => ({
  OTEL_EXPORTER_OTLP_ENDPOINT: url,
  OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
});

/** No request body holds a secret value. The bodies of protobuf hold their strings as UTF-8. */
export const holdsNoSecret = (received: ReadonlyArray<Received>) =>
  received.every((request) => hiddenSecrets.every((secret) => !request.body.includes(secret)));
