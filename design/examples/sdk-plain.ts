// SDK, plain TypeScript. Every operation comes from a client, and a client binds one config.
import * as Schema from "effect/Schema";
import {
  CacheEncryption,
  createEnvi,
  defineConfig,
  ExportFormat,
  fileCache,
  memoryCache,
  schemaOf,
  syncAll,
  ValueOrigin,
} from "envi";
import type {
  CacheRecord,
  CheckReport,
  Env,
  InspectReport,
  RawEnv,
  StageOf,
  SyncReport,
} from "envi";
import { onePasswordProvider, op } from "envi/1password";

import { assertType, type Equal } from "./assert.ts";
import config from "./config-staged.ts";
import staticConfig from "./config-static.ts";

// 1. The client binds one config. It uses the providers and the cache settings of the config.
const envi = createEnvi(config);

// 2. Static: load the config. The stage comes from ENVI_STAGE, `defaultStage`, or "development".
const env = await envi.load();

assertType<Equal<typeof env.PORT, number>>();
assertType<Equal<typeof env.DATABASE_URL, URL>>();
assertType<Equal<typeof env.SENTRY_DSN, string | undefined>>();
assertType<Equal<typeof env.LOG_LEVEL, "debug" | "info">>();
assertType<Equal<typeof env.NODE_ENV, string>>();
assertType<Equal<typeof env.GITHUB_SHA, string>>();

// 3. An explicit stage. The stage type comes from `stages`.
await envi.load({ stage: "staging" });
// @ts-expect-error "prodution" is not a declared stage
await envi.load({ stage: "prodution" });

assertType<Equal<StageOf<typeof config>, "development" | "staging" | "production">>();
assertType<Equal<StageOf<typeof staticConfig>, string>>();

// 4. Refresh on demand, and strict mode.
await envi.load({ stage: "production", refresh: true, strict: true });

// 5. Types and the schema for application code.
type AppEnv = Env<typeof config>;
type AppRawEnv = RawEnv<typeof config>;

assertType<Equal<AppRawEnv["PORT"], string>>();
assertType<Equal<AppRawEnv["SENTRY_DSN"], string | undefined>>();

export const startServer = (appEnv: AppEnv) => `listening on ${appEnv.PORT}`;

export const AppEnvSchema = schemaOf(config, { stage: "production" });

assertType<Equal<typeof AppEnvSchema.Type, AppEnv>>();
assertType<Equal<typeof AppEnvSchema.Encoded, AppRawEnv>>();

// 6. Raw strings. The caller decides what to do with them. Envi never changes `process.env`.
const raw = await envi.loadRaw({ stage: "development" });

assertType<Equal<typeof raw, AppRawEnv>>();

Object.assign(process.env, raw);

// 7. Validate strings that already exist. No provider, no cache, no promise.
const parsed = envi.parse(process.env, { stage: "production" });

assertType<Equal<typeof parsed, AppEnv>>();

// 8. The CLI commands as methods. Each one returns the report that `--json` prints.
const synced = await envi.sync({ refresh: true });
const checked = await envi.check({ stage: "production" });
const inspected = await envi.inspect();
const child = await envi.run("bun", ["scripts/dev.ts"], { stage: "development" });

assertType<Equal<typeof synced, SyncReport>>();
assertType<Equal<typeof checked, CheckReport>>();
assertType<Equal<typeof inspected, InspectReport>>();
assertType<Equal<typeof child.exitCode, number>>();

export const literalVars = inspected.vars.filter((item) => item.origin === ValueOrigin.Literal);

const dotenv: string = await envi.export(ExportFormat.Dotenv, { stage: "development" });
const preview: string = await envi.export(ExportFormat.Json, { redact: true });

const cacheDirectory: string = envi.cache.path();
const cached = await envi.cache.list();
const cleared = await envi.cache.clear();

assertType<Equal<typeof cleared.removed, number>>();

// 9. A monorepo: one batch for each provider across all clients.
export const syncedAll = await syncAll([envi, createEnvi(staticConfig)]);

// 10. Dynamic: resolve one secret without `vars`. The config holds only the providers.
const dynamic = createEnvi(
  defineConfig({ providers: [onePasswordProvider({ account: "my-team" })] }),
);
const stripeKey = await dynamic.resolve(op("payments", "stripe", "secret-key"));

assertType<Equal<typeof stripeKey, string>>();

// 11. Dynamic: resolve a record in one batch, with schemas and options.
const tenant = "acme";
const secrets = await dynamic.resolve(
  {
    apiKey: op(`tenant-${tenant}`, "api", "key"),
    limit: op(`tenant-${tenant}`, "api", "rate-limit").schema(Schema.NumberFromString),
    webhook: op(`tenant-${tenant}`, "api", "webhook").optional(),
  },
  { refresh: true },
);

assertType<Equal<typeof secrets.limit, number>>();
assertType<Equal<typeof secrets.webhook, string | undefined>>();

// 12. Cache choices. The second argument overrides the config.
createEnvi(config, { cache: memoryCache() });
createEnvi(config, {
  cache: fileCache({ directory: ".envi/cache", encryption: CacheEncryption.None }),
});
createEnvi(config, { cache: { ttl: "1 hour", maxStale: "1 day" } });
createEnvi(config, { cache: false });

// 13. A custom cache: an object with four promise methods.
const records = new Map<string, CacheRecord>();

createEnvi(config, {
  cache: {
    getMany: async (keys) => {
      const found: Record<string, CacheRecord> = {};

      for (const key of keys) {
        const record = records.get(key);

        if (record !== undefined) {
          found[key] = record;
        }
      }

      return found;
    },
    setMany: async (incoming) => {
      for (const [key, record] of Object.entries(incoming)) {
        records.set(key, record);
      }
    },
    removeMany: async (keys) => {
      for (const key of keys) {
        records.delete(key);
      }
    },
    clear: async () => {
      records.clear();
    },
  },
});

export { cached, cacheDirectory, dotenv, preview };
