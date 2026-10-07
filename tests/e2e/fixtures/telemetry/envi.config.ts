import { defineConfig } from "@kynnyhsap/envi";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";

// The telemetry tests. Each `custom()` puts a secret where telemetry could pick it up: a throw, an
// error inside a span, an attribute of a span, an event, or a link, the URL of an HTTP request, and
// an error in the cause, the message, or the annotations of a log. No span and no log may hold the
// secret.
import { fileProvider } from "../file-provider.ts";

export default defineConfig({
  providers: [fileProvider],
  cache: false,
  vars: ({ file, custom }) => ({
    API_TOKEN: file("token-development"),
    LEAKY: custom({
      id: "leaky",
      from: { password: file("db-password") },
      resolve: ({ password }) => {
        throw new Error(`cannot connect with ${password}`);
      },
    }),
    TRACED: custom({
      id: "traced",
      from: { password: file("db-password") },
      resolve: ({ password }) => {
        const link = {
          span: Tracer.externalSpan({ traceId: "1".repeat(32), spanId: "2".repeat(16) }),
          attributes: { "url.full": `https://api.example.com/?key=${password}` },
        };

        return Effect.gen(function* () {
          const span = yield* Effect.currentSpan;

          span.event("retry", yield* Clock.currentTimeNanos, {
            "url.full": `https://api.example.com/?key=${password}`,
            error: new Error(`cannot connect with ${password}`),
          });
          span.addLinks([{ ...link, attributes: { "http.request.header.x-token": password } }]);
          yield* Effect.annotateCurrentSpan("error", new Error(`cannot connect with ${password}`));

          return yield* Effect.fail(new Error(`cannot connect with ${password}`));
        }).pipe(Effect.withSpan("exchange", { links: [link] }));
      },
    }),
    // A test sets the server. Without it, nothing listens on port 1, so the request fails at once.
    REQUEST: custom({
      id: "request",
      from: { password: file("db-password") },
      resolve: ({ password }) =>
        HttpClient.get(
          `${process.env["ENVI_E2E_HTTP_URL"] ?? "http://127.0.0.1:1"}/?key=${password}`,
        ).pipe(Effect.provide(FetchHttpClient.layer), Effect.as("unused")),
    }),
    LOGGED: custom({
      id: "logged",
      from: { password: file("db-password") },
      resolve: ({ password }) =>
        Effect.logError("The exchange failed.", Cause.fail(new Error(`bad key ${password}`))).pipe(
          Effect.andThen(Effect.logError("The retry failed.", new Error(`bad key ${password}`))),
          Effect.andThen(Effect.logError({ error: new Error(`bad key ${password}`) })),
          Effect.andThen(Effect.logError([new Error(`bad key ${password}`)])),
          Effect.andThen(Effect.logError(Option.some(new Error(`bad key ${password}`)))),
          Effect.andThen(Effect.logError({ cause: Cause.fail(new Error(`bad key ${password}`)) })),
          Effect.andThen(Effect.logError(new Map([["error", new Error(`bad key ${password}`)]]))),
          Effect.andThen(
            Effect.logError("The count is ready.").pipe(
              Effect.annotateLogs("_tag", "Ready"),
              Effect.annotateLogs("count", 3),
            ),
          ),
          Effect.andThen(
            Effect.logError("The call failed.").pipe(
              Effect.annotateLogs("error", new Error(`bad key ${password}`)),
            ),
          ),
          Effect.as("logged"),
        ),
    }),
  }),
});
