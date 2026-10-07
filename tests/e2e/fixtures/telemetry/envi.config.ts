import { defineConfig } from "@kynnyhsap/envi";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";

// The telemetry tests. Each `custom()` puts a secret where telemetry could pick it up: a throw, an
// error inside a span, the URL of an HTTP request, and the cause of a log. No span and no log may
// hold the secret.
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
      resolve: ({ password }) =>
        Effect.fail(new Error(`cannot connect with ${password}`)).pipe(Effect.withSpan("exchange")),
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
          Effect.as("logged"),
        ),
    }),
  }),
});
