// The cache tests. The test selects the encryption and the ttl through the environment.
import * as Schema from "effect/Schema";
import { defineConfig } from "envi";

import { fileProvider } from "../file-provider.ts";

export default defineConfig({
  stages: ["development", "production"],
  providers: [fileProvider],
  cache: {
    encryption: process.env["ENVI_E2E_ENCRYPTION"] === "none" ? "none" : "keychain",
    ttl: process.env["ENVI_E2E_TTL"] === "short" ? "1 second" : "24 hours",
  },
  vars: ({ stage, file, value, custom, fromEnv }) => ({
    NODE_ENV: stage,
    PORT: value("3000").schema(Schema.FiniteFromString),
    API_TOKEN: file(`token-${stage}`),
    PRIVATE_KEY: file("private-key"),
    OPTIONAL: file("absent").optional(),
    WITH_DEFAULT: file("absent").default("fallback"),
    PUBLIC_NAME: file("public-name").redact(false),
    UNCACHED: file("uncached").cache(false),
    FROM_PARENT: fromEnv("ENVI_E2E_PARENT").optional(),
    DATABASE_URL: custom({
      key: "database-url",
      from: { user: file("db-user"), password: file("db-password") },
      resolve: ({ user, password }) => `postgres://${user}:${password}@db.invalid/app`,
    }),
  }),
});
