import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Cache from "./Cache.ts";
import { defineConfig } from "./Config.ts";
import * as Envi from "./Envi.ts";
import { DecodeError, ExportError, ReferenceError, UnknownStageError } from "./Errors.ts";
import { mem, memoryProvider } from "./Memory.ts";
import { ExportFormat, ValueOrigin } from "./Reports.ts";
import * as Source from "./Source.ts";

const secrets = {
  "db/development": "postgres://dev",
  "db/production": "postgres://prod",
  token: "s3cret value",
};

const makeConfig = (provider = memoryProvider(secrets)) =>
  defineConfig({
    stages: ["development", "production"],
    defaultStage: "development",
    providers: [provider],
    vars: ({ stage, mem: secret, value }) => ({
      NODE_ENV: stage === "production" ? "production" : "development",
      PORT: value("3000").schema(Schema.FiniteFromString),
      DATABASE_URL: secret(`db/${stage}`),
      TOKEN: secret("token"),
      SENTRY_DSN: secret("sentry").optional(),
    }),
  });

const layer = Layer.provide(Envi.layer(), Cache.layerMemory);

const withEnv = (env: Readonly<Record<string, string>>) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown(env));

describe("Envi", () => {
  it.effect("loads the decoded values of the default stage", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const config = makeConfig();
      const env = yield* envi.load(config);

      expectTypeOf(env.PORT).toEqualTypeOf<number>();
      expectTypeOf(env.SENTRY_DSN).toEqualTypeOf<string | undefined>();

      expect(env).toEqual({
        NODE_ENV: "development",
        PORT: 3000,
        DATABASE_URL: "postgres://dev",
        TOKEN: "s3cret value",
        SENTRY_DSN: undefined,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("loads the raw strings", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const raw = yield* envi.loadRaw(makeConfig(), { stage: "production" });

      expect(raw.PORT).toBe("3000");
      expect(raw.DATABASE_URL).toBe("postgres://prod");
      expect(raw.SENTRY_DSN).toBeUndefined();
    }).pipe(Effect.provide(layer)),
  );

  it.effect("picks the stage from the option, then ENVI_STAGE, then the default stage", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const config = makeConfig();

      expect((yield* envi.load(config)).NODE_ENV).toBe("production");
      expect((yield* envi.load(config, { stage: "development" })).NODE_ENV).toBe("development");
    }).pipe(Effect.provide(layer), Effect.provide(withEnv({ ENVI_STAGE: "production" }))),
  );

  it.effect("rejects a stage that the config does not declare", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const error = yield* Effect.flip(envi.load(makeConfig()));

      expect(error).toBeInstanceOf(UnknownStageError);
    }).pipe(Effect.provide(layer), Effect.provide(withEnv({ ENVI_STAGE: "qa" }))),
  );

  it.effect("fails a load with the failure of the first failed var", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;

      const config = defineConfig({
        providers: [memoryProvider({})],
        vars: { A: "1", MISSING: mem("missing") },
      });

      const error = yield* Effect.flip(envi.load(config));

      expect(error).toBeInstanceOf(ReferenceError);
      expect(error).toMatchObject({ reference: "memory://missing" });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("replaces the providers of the config with the providers of the layer", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const env = yield* envi.load(makeConfig(memoryProvider({})), { stage: "production" });

      expect(env.DATABASE_URL).toBe("postgres://override");
    }).pipe(
      Effect.provide(
        Layer.provide(
          Envi.layer({
            providers: [memoryProvider({ "db/production": "postgres://override", token: "t" })],
          }),
          Cache.layerMemory,
        ),
      ),
    ),
  );

  it.effect("parses existing strings without a provider call", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const provider = memoryProvider(secrets);
      const config = makeConfig(provider);
      const env = yield* envi.parse(config, { PORT: "8080", DATABASE_URL: "x", TOKEN: "t" });

      expect(env).toEqual({
        NODE_ENV: "development",
        PORT: 8080,
        DATABASE_URL: "x",
        TOKEN: "t",
        SENTRY_DSN: undefined,
      });
      expect(provider.calls()).toEqual([]);

      const missing = yield* Effect.flip(envi.parse(config, { PORT: "8080" }));

      const invalid = yield* Effect.flip(
        envi.parse(config, { PORT: "secret-port", DATABASE_URL: "x", TOKEN: "t" }),
      );

      expect(missing).toBeInstanceOf(DecodeError);
      expect(missing).toMatchObject({ key: "DATABASE_URL" });
      expect(invalid).toMatchObject({ key: "PORT" });
      expect(invalid.message).not.toContain("secret-port");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("resolves one descriptor and a record of descriptors", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const provider = memoryProvider({ port: "5432", user: "app" });
      const config = defineConfig({ providers: [provider] });

      const port = yield* envi.resolve(config, mem("port").schema(Schema.FiniteFromString));
      const record = yield* envi.resolve(config, { user: mem("user"), none: mem("x").optional() });

      expectTypeOf(port).toEqualTypeOf<number>();
      expectTypeOf(record).toEqualTypeOf<{
        readonly user: string;
        readonly none: string | undefined;
      }>();

      expect(port).toBe(5432);
      expect(record).toEqual({ user: "app", none: undefined });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("syncs and reports the counts and each failed var without a failure", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;

      const config = defineConfig({
        providers: [memoryProvider({ a: "1", bad: "not-a-number" })],
        vars: {
          A: mem("a"),
          BAD: mem("bad").schema(Schema.FiniteFromString),
          MISSING: mem("missing"),
        },
      });

      const first = yield* envi.sync(config);
      const second = yield* envi.sync(config);

      expect(first.stage).toBe("development");
      expect(first.configs).toBe(1);
      expect(first.providers).toEqual([{ provider: "memory", secrets: 3, cached: 0, resolved: 3 }]);
      expect(first.failures).toEqual([
        { key: "BAD", reference: null, error: "DecodeError", reason: expect.any(String) },
        {
          key: "MISSING",
          reference: "memory://missing",
          error: "ReferenceError",
          reason: "NotFound",
        },
      ]);
      expect(JSON.stringify(first)).not.toContain("not-a-number");
      // A required var never trusts a cached `NotFound`, so Envi asks again for MISSING.
      expect(second.providers[0]).toMatchObject({ cached: 2, resolved: 1 });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("syncs several configs with one call to a shared provider", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const provider = memoryProvider({ a: "1", b: "2" });
      const web = defineConfig({ providers: [provider], vars: { A: mem("a") } });
      const api = defineConfig({ providers: [provider], vars: { A: mem("a"), B: mem("b") } });

      const other = defineConfig({
        providers: [memoryProvider({ c: "3" })],
        vars: { C: mem("c") },
      });

      const report = yield* envi.sync([web, api, other]);

      expect(report.configs).toBe(3);
      expect(provider.calls()).toEqual([["a", "b"]]);
      expect(report.providers).toEqual([
        { provider: "memory", secrets: 3, cached: 0, resolved: 3 },
      ]);
      expect(report.failures).toEqual([]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("checks every var and lists the passed and the failed vars", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;

      const config = defineConfig({
        providers: [memoryProvider({ a: "1" })],
        vars: { A: mem("a"), MISSING: mem("missing") },
      });

      const report = yield* envi.check(config);

      expect(report.passed).toEqual(["A"]);
      expect(report.failures.map((failure) => failure.key)).toEqual(["MISSING"]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("inspects with redacted secrets by default", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const config = makeConfig();
      const report = yield* envi.inspect(config);
      const byKey = Object.fromEntries(report.vars.map((entry) => [entry.key, entry]));

      expect(report.stage).toBe("development");
      expect(byKey["PORT"]).toMatchObject({
        origin: ValueOrigin.Literal,
        redacted: false,
        value: "3000",
      });
      expect(byKey["TOKEN"]).toMatchObject({
        provider: "memory",
        reference: "memory://token",
        origin: ValueOrigin.Provider,
        redacted: true,
        value: null,
      });
      expect(byKey["SENTRY_DSN"]).toMatchObject({ origin: ValueOrigin.Unset, value: null });
      expect(JSON.stringify(report)).not.toContain("s3cret");

      const open = yield* envi.inspect(config, { redact: false });

      expect(open.vars.find((entry) => entry.key === "TOKEN")?.value).toBe("s3cret value");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("exports dotenv and json with real values, and hides secrets on request", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const config = makeConfig();

      expect(yield* envi.export(config, ExportFormat.Dotenv)).toBe(
        [
          "NODE_ENV=development",
          "PORT=3000",
          "DATABASE_URL=postgres://dev",
          "TOKEN='s3cret value'",
          "",
        ].join("\n"),
      );

      expect(JSON.parse(yield* envi.export(config, ExportFormat.Json))).toEqual({
        NODE_ENV: "development",
        PORT: "3000",
        DATABASE_URL: "postgres://dev",
        TOKEN: "s3cret value",
      });

      const redacted = yield* envi.export(config, ExportFormat.Dotenv, { redact: true });

      expect(redacted).toContain("PORT=3000");
      expect(redacted).not.toContain("s3cret");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fails a dotenv export of a value that dotenv cannot represent", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;

      const config = defineConfig({
        providers: [memoryProvider({ multi: "line one\nline two", odd: "it's\n$HOME" })],
        vars: { MULTI: mem("multi") },
      });

      const odd = defineConfig({
        providers: [memoryProvider({ odd: "it's\n$HOME" })],
        vars: { ODD: mem("odd") },
      });

      expect(yield* envi.export(config, ExportFormat.Dotenv)).toBe('MULTI="line one\\nline two"\n');

      const error = yield* Effect.flip(envi.export(odd, ExportFormat.Dotenv));

      expect(error).toBeInstanceOf(ExportError);
      expect(error).toMatchObject({ key: "ODD" });
      expect(error.message).not.toContain("HOME");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("lists and clears the cache", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;

      yield* envi.sync(makeConfig());

      const list = yield* envi.cache.list;

      expect(yield* envi.cache.path).toEqual(Option.none());
      expect(list.directory).toBeNull();
      expect(list.entries.map((entry) => entry.reference)).toEqual([
        "memory://db/development",
        "memory://sentry",
        "memory://token",
      ]);
      expect(list.entries[0]?.resolvedAt).toBe("1970-01-01T00:00:00.000Z");
      expect(yield* envi.cache.clear).toEqual({ removed: 3 });
      expect((yield* envi.cache.list).entries).toEqual([]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("keeps a fromEnv value out of the cache and reads it from the environment", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const config = defineConfig({ vars: { SHA: Source.fromEnv("GITHUB_SHA") } });

      expect((yield* envi.load(config)).SHA).toBe("abc123");
      expect((yield* envi.cache.list).entries).toEqual([]);
    }).pipe(Effect.provide(layer), Effect.provide(withEnv({ GITHUB_SHA: "abc123" }))),
  );
});
