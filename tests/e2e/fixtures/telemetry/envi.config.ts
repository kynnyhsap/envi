import { defineConfig } from "@kynnyhsap/envi";
import * as Effect from "effect/Effect";

// The telemetry tests. Each `custom()` fails with an error whose message holds a secret: one throws,
// and one fails inside a span of its own. No span and no log may hold that message.
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
  }),
});
