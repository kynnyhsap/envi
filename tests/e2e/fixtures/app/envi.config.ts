import { defineConfig, memoryProvider } from "envi";

export default defineConfig({
  stages: ["development", "production"],
  providers: [
    memoryProvider({ "db/development": "postgres://dev", "db/production": "postgres://prod" }),
  ],
  cache: false,
  vars: ({ stage, mem, value }) => ({
    PORT: value("3000"),
    DATABASE_URL: mem(`db/${stage}`),
    SENTRY_DSN: mem("sentry").optional(),
  }),
});
