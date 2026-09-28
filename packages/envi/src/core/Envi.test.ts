import { assert, describe, expect, expectTypeOf, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { defineConfig } from "./Config.ts";
import * as Envi from "./Envi.ts";
import { docsBase } from "./ErrorClass.ts";
import {
  ConfigLoadError,
  ConfigLoadFailure,
  DecodeError,
  ExportError,
  hints,
  ReferenceFailure,
  SecretReferenceError,
  SettingsError,
  UnknownStageError,
  VarsError,
} from "./Errors.ts";
import { enviLayer, withEnv } from "./fixtures/Support.ts";
import { mem, memoryProvider } from "./Memory.ts";
import * as Provider from "./Provider.ts";
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

const layer = enviLayer();

/** A provider that records whether each batch may ask the user. */
const recording = () => {
  const seen: Array<boolean> = [];

  const provider = Provider.make({
    id: "memory",
    scope: "recording",
    resolveMany: (requests, context) =>
      Effect.sync(() => {
        seen.push(context.interactive);

        return Object.fromEntries(
          requests.map((request) => [request.key, Result.succeed("value")]),
        );
      }),
    helpers: {},
  });

  return { seen, config: defineConfig({ providers: [provider], vars: { A: mem("a") } }) };
};

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

  it.effect("picks the stage from the option, then ENVI_STAGE, then defaultStage", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;

      const staged = defineConfig({
        stages: ["development", "staging", "production"],
        defaultStage: "staging",
        vars: ({ stage }) => ({ STAGE: stage }),
      });

      const bare = defineConfig({ vars: ({ stage }) => ({ STAGE: stage }) });
      const selected = withEnv({ ENVI_STAGE: "production" });
      // NODE_ENV never selects the stage.
      const unselected = withEnv({ NODE_ENV: "production" });

      const byOption = yield* envi.load(staged, { stage: "development" }).pipe(selected);

      const byVariable = yield* envi.load(staged).pipe(selected);
      const byDefault = yield* envi.load(staged).pipe(unselected);
      const byFallback = yield* envi.load(bare).pipe(unselected);

      expect(byOption.STAGE).toBe("development");
      expect(byVariable.STAGE).toBe("production");
      expect(byDefault.STAGE).toBe("staging");
      expect(byFallback.STAGE).toBe("development");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects a stage that the config does not declare", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const error = yield* Effect.flip(envi.load(makeConfig()));

      assert(error instanceof UnknownStageError);
      expect(error.stage).toBe("qa");
      expect(error.stages).toEqual(["development", "production"]);
    }).pipe(Effect.provide(layer), withEnv({ ENVI_STAGE: "qa" })),
  );

  it.effect("fails a load with every failed var, the stage, and a hint for each failure", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;

      const config = defineConfig({
        providers: [memoryProvider({ word: "not-a-number-secret" })],
        vars: {
          A: "1",
          MISSING: mem("missing"),
          PORT: mem("word").schema(Schema.FiniteFromString),
        },
      });

      const error = yield* Effect.flip(envi.load(config));

      assert(error instanceof VarsError);
      expect(error.stage).toBe("development");
      expect(error.failures.map((failure) => failure.key)).toEqual(["MISSING", "PORT"]);
      expect(error.failures[0]?.error).toBeInstanceOf(SecretReferenceError);
      expect(error.failures[0]?.error).toMatchObject({ reference: "memory://missing" });
      expect(error.failures[1]?.error).toMatchObject({ key: "PORT", expected: "a finite number" });
      expect(error.message).toContain("MISSING");
      expect(error.message).toContain(hints.SecretReferenceError.NotFound);
      expect(error.message).toContain(`${docsBase}error-secret-reference-not-found`);
      expect(error.message).not.toContain("not-a-number-secret");
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "fails with VarsThrew and the location when vars throws",
    () =>
      Effect.gen(function* () {
        const envi = yield* Envi.Envi;

        const config = defineConfig({
          vars: (): Record<string, string> => {
            throw new TypeError("fake-secret-in-vars");
          },
        });

        const error = yield* Effect.flip(envi.load(config));

        assert(error instanceof ConfigLoadError);
        expect(error.reason).toBe(ConfigLoadFailure.VarsThrew);
        expect(error.location).toMatch(/Envi\.test\.ts:\d+:\d+$/u);
        expect(error.message).not.toContain("fake-secret-in-vars");
      }).pipe(Effect.provide(layer)),
    // On Bun under load, the location is sometimes missing: in CI and in a loaded local run since
    // Effect 4.0.0-rc.118. The cause is unknown, and the test never failed alone or on Node. The
    // retry keeps the rule under test until a fix removes the retry.
    { retry: 2 },
  );

  it.effect("fails a single resolve with the error of the descriptor", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const config = defineConfig({ providers: [memoryProvider({})] });
      const error = yield* Effect.flip(envi.resolve(config, mem("missing")));

      expect(error).toBeInstanceOf(SecretReferenceError);
      expect(error).toMatchObject({
        reason: ReferenceFailure.NotFound,
        reference: "memory://missing",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("replaces the providers of the config with the providers of the layer", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const env = yield* envi.load(makeConfig(memoryProvider({})), { stage: "production" });

      expect(env.DATABASE_URL).toBe("postgres://override");
    }).pipe(
      Effect.provide(
        enviLayer({
          providers: [memoryProvider({ "db/production": "postgres://override", token: "t" })],
        }),
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

      assert(missing instanceof VarsError);
      expect(missing.failures.map((failure) => failure.key)).toEqual(["DATABASE_URL", "TOKEN"]);
      expect(missing.failures[0]?.error).toBeInstanceOf(DecodeError);
      expect(invalid).toMatchObject({ failures: [{ key: "PORT" }] });
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
        {
          key: "BAD",
          config: null,
          reference: null,
          error: "DecodeError",
          reason: "a finite number",
          summary: "Envi value does not match its schema: BAD expects a finite number",
          hint: hints.DecodeError,
          docs: `${docsBase}error-decode`,
        },
        {
          key: "MISSING",
          config: null,
          reference: "memory://missing",
          error: "SecretReferenceError",
          reason: "NotFound",
          summary: expect.stringContaining("memory://missing"),
          hint: hints.SecretReferenceError.NotFound,
          docs: `${docsBase}error-secret-reference-not-found`,
        },
      ]);
      expect(JSON.stringify(first)).not.toContain("not-a-number");
      // Only a var that accepts a missing value caches `NotFound`, so Envi asks again for MISSING.
      expect(second.providers[0]).toMatchObject({ cached: 2, resolved: 1 });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("asks again for a required var when the cache holds NotFound", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const store: Record<string, string> = {};
      const provider = memoryProvider(store);
      const optional = defineConfig({ providers: [provider], vars: { A: mem("a").optional() } });
      const required = defineConfig({ providers: [provider], vars: { A: mem("a") } });

      expect(yield* envi.load(optional)).toEqual({ A: undefined });

      store["a"] = "1";

      expect(yield* envi.load(required)).toEqual({ A: "1" });
      expect(provider.calls()).toEqual([["a"], ["a"]]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("syncs several configs with one call to a shared provider", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const provider = memoryProvider({ a: "1", b: "2" });
      const web = defineConfig({ providers: [provider], vars: { A: mem("a") } });
      const api = defineConfig({ providers: [provider], vars: { A: mem("a"), B: mem("b") } });

      const other = {
        ...defineConfig({
          providers: [memoryProvider({ c: "3" })],
          vars: { C: mem("c"), MISSING: mem("missing") },
        }),
        path: Option.some("/repo/tools/envi.config.ts"),
      };

      const report = yield* envi.sync([web, api, other]);

      expect(report.configs).toBe(3);
      expect(provider.calls()).toEqual([["a", "b"]]);
      expect(report.providers).toEqual([
        { provider: "memory", secrets: 4, cached: 0, resolved: 4 },
      ]);
      expect(report.failures).toMatchObject([
        { key: "MISSING", config: "/repo/tools/envi.config.ts", reason: "NotFound" },
      ]);
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
    }).pipe(Effect.provide(layer), withEnv({ GITHUB_SHA: "abc123" })),
  );

  describe("interactive", () => {
    const interactiveOf = (
      env: Readonly<Record<string, string>>,
      options: Envi.LayerOptions = {},
    ) =>
      Effect.gen(function* () {
        const { seen, config } = recording();

        yield* Effect.flatMap(Envi.Envi, (envi) => envi.load(config)).pipe(
          Effect.provide(enviLayer(options)),
          withEnv(env),
        );

        return seen[0];
      });

    it.effect("is on outside CI, off in CI, and set by ENVI_INTERACTIVE and the option", () =>
      Effect.gen(function* () {
        expect(yield* interactiveOf({})).toBe(true);
        expect(yield* interactiveOf({ CI: "true" })).toBe(false);
        expect(yield* interactiveOf({ CI: "woodpecker" })).toBe(false);
        expect(yield* interactiveOf({ CI: "false" })).toBe(true);
        expect(yield* interactiveOf({ CI: "0" })).toBe(true);
        expect(yield* interactiveOf({ CI: "" })).toBe(true);
        expect(yield* interactiveOf({ ENVI_INTERACTIVE: "false" })).toBe(false);
        expect(yield* interactiveOf({ CI: "true", ENVI_INTERACTIVE: "true" })).toBe(true);
        expect(yield* interactiveOf({ ENVI_INTERACTIVE: "true" }, { interactive: false })).toBe(
          false,
        );
      }),
    );

    it.effect("rejects an ENVI_INTERACTIVE value that is not a boolean", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(interactiveOf({ ENVI_INTERACTIVE: "maybe" }));

        expect(error).toBeInstanceOf(SettingsError);
        expect(error).toMatchObject({ name: "ENVI_INTERACTIVE" });
      }),
    );
  });
});
