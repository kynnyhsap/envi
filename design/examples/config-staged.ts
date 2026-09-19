// Config 2: typed stages, a provider, cache settings, schemas, and all three `op()` forms.
// `vars` receives the stage, the built-in helpers, and the helpers of each provider.
import * as Schema from "effect/Schema";
import { defineConfig } from "envi";
import { onePasswordProvider } from "envi/1password";

declare const fetchBuildNumber: () => Promise<string>;

export default defineConfig({
  stages: ["development", "staging", "production"],
  defaultStage: "development",
  providers: [onePasswordProvider({ account: "my-team" })],
  cache: { ttl: "12 hours", maxStale: "3 days" },
  vars: ({ stage, op, value, custom, fromEnv }) => ({
    NODE_ENV: stage === "production" ? "production" : "development",
    PORT: value("3000").schema(Schema.NumberFromString),
    DATABASE_URL: op(`op://app-${stage}/postgres/url`).schema(Schema.URLFromString),
    STRIPE_KEY: op("payments", "stripe", "secret-key"),
    SENTRY_DSN: op({
      vault: "observability",
      item: "sentry",
      section: "web",
      field: "dsn",
    }).optional(),
    LOG_LEVEL: op("app", "api", "log-level")
      .schema(Schema.Literals(["debug", "info"]))
      .default("info"),
    PUBLIC_KEY: op({
      account: "partner-team",
      vault: "shared",
      item: "jwt",
      field: "public",
    }).redact(false),
    // A short-lived secret: its own TTL. `.cache(false)` resolves a value on every load.
    SESSION_SIGNING_KEY: op("app", "api", "session-key").cache({ ttl: "1 hour" }),
    // A value from user code. The `key` is its cache key. Without a `key`, Envi never caches it.
    BUILD_NUMBER: custom({ key: `build-number/${stage}`, resolve: fetchBuildNumber })
      .redact(false)
      .cache({ ttl: "10 minutes" }),
    // A value from the environment of the Envi process, such as a CI secret.
    GITHUB_SHA: fromEnv("GITHUB_SHA").redact(false).default("local"),
  }),
});
