import { defineConfig } from "@kynnyhsap/envi";
// The cache tests. The test selects the encryption through the environment, or turns the cache
// off.
import * as Schema from "effect/Schema";

import { fileProvider } from "../file-provider.ts";

export default defineConfig({
  stages: ["development", "production"],
  providers: [fileProvider],
  cache:
    process.env["ENVI_E2E_CACHE"] === "off"
      ? false
      : {
          encryption: process.env["ENVI_E2E_ENCRYPTION"] === "none" ? "none" : "keychain",
        },
  vars: ({ stage, file, value, derive, custom, fromEnv }) => ({
    NODE_ENV: stage,
    PORT: value("3000").schema(Schema.FiniteFromString),
    API_TOKEN: file(`token-${stage}`),
    PRIVATE_KEY: file("private-key"),
    OPTIONAL: file("absent").optional(),
    WITH_DEFAULT: file("absent").default("fallback"),
    PUBLIC_NAME: file("public-name").redact(false),
    GREETING: derive(file("public-name"), (name) => `hello ${name}`).redact(false),
    UNCACHED: file("uncached").cache(false),
    FROM_PARENT: fromEnv("ENVI_E2E_PARENT").optional(),
    DATABASE_URL: custom({
      id: "database-url",
      from: { user: file("db-user"), password: file("db-password") },
      resolve: ({ user, password }) => `postgres://${user}:${password}@db.invalid/app`,
    }),
  }),
});
