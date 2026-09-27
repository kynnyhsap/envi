import * as ConfigProvider from "effect/ConfigProvider";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  Cache,
  createEnvi,
  DecodeError,
  defineConfig,
  Envi,
  layer,
  SecretReferenceError,
  SettingsError,
  syncAll,
  VarsError,
  type CacheKey,
  type EnviOptions,
} from "./index.ts";
import { mem, memoryProvider } from "./testing.ts";

const provider = memoryProvider({ "db/url": "postgres://fake", port: "5432" });

const config = defineConfig({
  providers: [provider],
  cache: false,
  vars: ({ mem: secret, value }) => ({
    PORT: value("3000").schema(Schema.FiniteFromString),
    DATABASE_URL: secret("db/url"),
    SENTRY_DSN: secret("sentry").optional(),
  }),
});

describe("createEnvi", () => {
  it("loads typed values through promises", async () => {
    const envi = createEnvi(config);
    const env = await envi.load();

    expectTypeOf(env.PORT).toEqualTypeOf<number>();
    expect(env).toEqual({ PORT: 3000, DATABASE_URL: "postgres://fake", SENTRY_DSN: undefined });
    expect((await envi.loadRaw()).PORT).toBe("3000");
    await envi.dispose();
  });

  it("rejects with the tagged error of the Effect API", async () => {
    const envi = createEnvi(
      defineConfig({ providers: [memoryProvider({})], cache: false, vars: { A: mem("a") } }),
    );

    await expect(envi.load()).rejects.toSatisfy(
      (error) =>
        error instanceof VarsError && error.failures[0]?.error instanceof SecretReferenceError,
    );

    await expect(envi.parse({})).rejects.toSatisfy(
      (error) => error instanceof VarsError && error.failures[0]?.error instanceof DecodeError,
    );

    await envi.dispose();
  });

  it("replaces the providers through the overrides", async () => {
    const envi = createEnvi(config, {
      providers: [memoryProvider({ "db/url": "postgres://override" })],
    });

    expect((await envi.load()).DATABASE_URL).toBe("postgres://override");
    await envi.dispose();
  });

  it("mirrors the commands: resolve, check, inspect, export, and cache", async () => {
    const envi = createEnvi(config);

    expect(await envi.resolve(mem("port").schema(Schema.FiniteFromString))).toBe(5432);
    expect((await envi.check()).failures).toEqual([]);
    expect((await envi.inspect()).vars.map((entry) => entry.key)).toEqual([
      "PORT",
      "DATABASE_URL",
      "SENTRY_DSN",
    ]);
    expect(await envi.export("dotenv", { redact: true })).toContain("PORT=3000");
    expect(await envi.cache.path()).toBeUndefined();
    expect(await envi.cache.clear()).toEqual({ removed: 0 });
    await envi.dispose();
  });

  it("runs a command with the resolved vars", async () => {
    const envi = createEnvi(config);

    const report = await envi.run(process.execPath, [
      "-e",
      'process.exit(process.env.DATABASE_URL === "postgres://fake" ? 7 : 1)',
    ]);

    expect(report).toEqual({ exitCode: 7 });
    await envi.dispose();
  });

  it("syncs several clients in one report", async () => {
    const web = createEnvi(config);

    const api = createEnvi(
      defineConfig({ providers: [provider], cache: false, vars: { PORT: mem("port") } }),
    );

    const report = await syncAll([web, api]);

    expect(report.configs).toBe(2);
    expect(report.failures).toEqual([]);
    await web.dispose();
    await api.dispose();
  });
});

describe("layer", () => {
  it("provides the Envi service with the options of a client", async () => {
    const program = Effect.flatMap(Envi.Envi, (envi) => envi.load(config));

    const env = await Effect.runPromise(
      program.pipe(Effect.provide(layer({ cache: false, providers: [provider] }))),
    );

    expect(env.DATABASE_URL).toBe("postgres://fake");
  });
});

const directories: Array<string> = [];

/** A temp folder for one cache. `afterEach` removes it. */
const cacheDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "envi-client-"));

  directories.push(directory);

  return directory;
};

// The cache is off in CI by default. These tests set the cache themselves.
beforeEach(() => {
  vi.stubEnv("CI", "false");
  vi.stubEnv("ENVI_CACHE_ENABLED", undefined);
  vi.stubEnv("ENVI_CACHE_DIR", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();

  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** The config of one secret, with a fresh provider that counts its calls. */
const oneSecret = (cache?: CacheKey) => {
  const secrets = memoryProvider({ "db/url": "postgres://fake" });
  const base = { providers: [secrets], vars: { DATABASE_URL: mem("db/url") } };

  return {
    secrets,
    oneConfig: cache === undefined ? defineConfig(base) : defineConfig({ ...base, cache }),
  };
};

const loads = 2;

/** Loads the config `loads` times through one client, and returns the provider calls. */
const callsOfLoads = async (cache: CacheKey | undefined, overrides: EnviOptions) => {
  const { secrets, oneConfig } = oneSecret(cache);
  const envi = createEnvi(oneConfig, overrides);

  for (let index = 0; index < loads; index++) {
    await envi.load();
  }

  await envi.dispose();

  return secrets.calls().length;
};

describe("the cache settings of a client", () => {
  it.each<{ readonly ttl: Duration.Input; readonly calls: number }>([
    { ttl: 0, calls: loads },
    { ttl: "1 hour", calls: 1 },
  ])("applies the ttl $ttl of the client option", async ({ ttl, calls }) => {
    const cache = { directory: cacheDirectory(), encryption: "none", ttl } as const;

    expect(await callsOfLoads(undefined, { cache })).toBe(calls);
  });

  it.each([
    { option: "no cache option", overrides: (): EnviOptions => ({}), calls: loads },
    {
      option: "a cache option",
      overrides: (): EnviOptions => ({
        cache: { directory: cacheDirectory(), encryption: "none" },
      }),
      calls: 1,
    },
  ])("replaces `cache: false` of the config with $option", async ({ overrides, calls }) => {
    expect(await callsOfLoads(false, overrides())).toBe(calls);
  });

  it("rejects a ttl that is not a duration, and writes no cache entry", async () => {
    const directory = cacheDirectory();
    // The type allows the exponent, and the parser of Effect rejects it.
    const invalid = oneSecret({ directory, encryption: "none", ttl: "1e3 hours" });
    const rejected = createEnvi(invalid.oneConfig);

    await expect(rejected.load()).rejects.toSatisfy(
      (error) => error instanceof SettingsError && error.name === "cache.ttl",
    );
    await rejected.dispose();

    expect(invalid.secrets.calls()).toEqual([]);
    expect(readdirSync(directory)).toEqual([]);

    const valid = createEnvi(oneSecret({ directory, encryption: "none", ttl: "1 hour" }).oneConfig);

    expect(await valid.load()).toEqual({ DATABASE_URL: "postgres://fake" });
    await valid.dispose();
  });
});

describe("the cache of a sync report", () => {
  /** The environment of the default layer: a temp home and a key from `ENVI_CACHE_KEY`. */
  const environment = () =>
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({ HOME: cacheDirectory(), ENVI_CACHE_KEY: "a test key" }),
    );

  it.each([
    { cache: false as const, reported: false },
    { cache: undefined, reported: true },
  ])("is $reported for a config with `cache: $cache`", async ({ cache, reported }) => {
    const { oneConfig } = oneSecret(cache);

    const report = await Effect.runPromise(
      Envi.Envi.use((envi) => envi.sync(oneConfig)).pipe(
        Effect.provide(layer()),
        Effect.provide(environment()),
      ),
    );

    expect(report.cache).toBe(reported);
  });

  it("is true for the in-memory cache, and the next load reads it", async () => {
    const { secrets, oneConfig } = oneSecret();

    const program = Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const report = yield* envi.sync(oneConfig);

      yield* envi.load(oneConfig);

      return report;
    });

    const report = await Effect.runPromise(
      program.pipe(Effect.provide(Envi.layer().pipe(Layer.provide(Cache.layerMemory)))),
    );

    expect(report.cache).toBe(true);
    expect(secrets.calls().length).toBe(1);
  });
});
