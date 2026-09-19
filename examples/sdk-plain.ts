// The plain TypeScript API. Each method runs the Effect of the same name and returns a promise.
import { onePasswordProvider, op } from "@envi/1password";
import * as Schema from "effect/Schema";
import {
  createEnvi,
  defineConfig,
  type Env,
  ExportFormat,
  mem,
  memoryProvider,
  type RawEnv,
  schemaOf,
  type StageOf,
  syncAll,
} from "envi";

import { assertType, type Equal } from "./assert.ts";
import config from "./config-staged.ts";
import staticConfig from "./config-static.ts";

// Use case 5: application code uses the config as types.
type AppEnv = Env<typeof config>;

assertType<Equal<AppEnv["PORT"], number>>();
assertType<Equal<AppEnv["DATABASE_URL"], URL>>();
assertType<Equal<AppEnv["SENTRY_DSN"], string | undefined>>();
assertType<Equal<AppEnv["LOG_LEVEL"], "debug" | "info">>();
assertType<Equal<RawEnv<typeof config>["PORT"], string>>();
assertType<Equal<StageOf<typeof config>, "development" | "staging" | "production">>();

// The schema of one stage. A form, a test, or a server can decode with it.
export const AppEnvSchema = schemaOf(config, "production");

// Use case 3: a program loads env through the SDK. A client binds one config.
const envi = createEnvi(config);

export const env = await envi.load({ stage: "production" });

assertType<Equal<typeof env.PORT, number>>();

// `loadRaw` returns the raw strings. Envi never changes `process.env`: the caller assigns them.
Object.assign(process.env, await envi.loadRaw());

// `parse` never resolves. It decodes strings that already exist, such as the vars of `envi run`.
export const parsed = await envi.parse(process.env);

// Use case 4: a program resolves one secret, or a record of secrets in one batch.
export const stripeKey = await envi.resolve(op("payments", "stripe", "secret-key"));

export const database = await envi.resolve({
  url: op("app", "postgres", "url").schema(Schema.URLFromString),
  replica: op("app", "postgres", "replica-url").optional(),
});

assertType<Equal<typeof database, { readonly url: URL; readonly replica: string | undefined }>>();

// The client mirrors the CLI. Each method returns the report that `--json` prints.
const syncReport = await envi.sync({ refresh: true });
const checkReport = await envi.check({ stage: "staging" });
const inspectReport = await envi.inspect();
const dotenv = await envi.export(ExportFormat.Dotenv, { redact: true });
const runReport = await envi.run("bun", ["run", "dev"], { cwd: "apps/web" });

export const reports = { syncReport, checkReport, inspectReport, dotenv, runReport };

export const cache = {
  path: await envi.cache.path(),
  entries: await envi.cache.list(),
  cleared: await envi.cache.clear(),
};

// Use case 1: one sync for a whole monorepo, with one call for each shared provider.
export const monorepo = await syncAll([envi, createEnvi(staticConfig)], { stage: "development" });

// The overrides win over the config. A test replaces the providers and turns the cache off.
const testClient = createEnvi(
  defineConfig({
    providers: [onePasswordProvider({ account: "my-team" })],
    vars: { TOKEN: mem("token") },
  }),
  { providers: [memoryProvider({ token: "fake" })], cache: false, strict: true },
);

export const testEnv = await testClient.load();

await envi.dispose();
