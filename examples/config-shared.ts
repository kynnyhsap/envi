import { onePasswordProvider, op } from "@envi/1password";
// Config 3: a monorepo. `shared` and `sentry` live in `envi.shared.ts` at the repo root.
// A shared module sits outside `vars`, so it imports `op`. The import and the `vars` parameter
// give the same function.
import { defineConfig } from "envi";

export const shared = {
  stages: ["development", "production"],
  providers: [onePasswordProvider({ account: "my-team" })],
} as const;

export const sentry = {
  SENTRY_DSN: op("observability", "sentry", "dsn"),
} as const;

// apps/api/envi.config.ts
export default defineConfig({
  ...shared,
  vars: ({ stage }) => ({
    ...sentry,
    DATABASE_URL: op(`op://app-${stage}/postgres/url`),
  }),
});
