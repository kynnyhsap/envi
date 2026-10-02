import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { enviLayer, withEnv } from "./core/fixtures/Support.ts";
import {
  createEnvi,
  DecodeError,
  defineConfig,
  Envi,
  layer,
  Provider,
  ProviderError,
  ProviderFailure,
  SecretReferenceError,
  SettingsError,
  syncAll,
  VarsError,
  type CacheKey,
  type EnviOptions,
} from "./index.ts";
import { mem, memoryProvider, memoryProviderId } from "./testing.ts";

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

  it("syncs several clients in one report, with one call to a shared provider", async () => {
    const shared = memoryProvider({ "db/url": "postgres://fake", port: "5432" });

    const web = createEnvi(
      defineConfig({ providers: [shared], cache: false, vars: { DATABASE_URL: mem("db/url") } }),
    );

    const api = createEnvi(
      defineConfig({ providers: [shared], cache: false, vars: { PORT: mem("port") } }),
    );

    const report = await syncAll([web, api]);

    expect(report.configs).toBe(2);
    expect(report.failures).toEqual([]);
    expect(shared.calls()).toEqual([["db/url", "port"]]);
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

  it("syncAll caches the clients that use the cache when the first client turns it off", async () => {
    const directory = cacheDirectory();
    // Two providers give two groups, so each config keeps its own policy.
    const off = oneSecret(false);
    const cached = oneSecret({ directory, encryption: "none" });
    const clients = [createEnvi(off.oneConfig), createEnvi(cached.oneConfig)] as const;

    await syncAll(clients);

    const reader = createEnvi(cached.oneConfig);

    expect(await reader.load()).toEqual({ DATABASE_URL: "postgres://fake" });
    expect(cached.secrets.calls().length).toBe(1);
    expect(readdirSync(directory).filter((name) => name.endsWith(".json")).length).toBe(1);

    for (const client of [...clients, reader]) {
      await client.dispose();
    }
  });
});

/** A provider that records `interactive` for each batch, and fails as a whole while `down`. */
const switchable = () => {
  const state = { down: false, interactive: new Array<boolean>() };

  const source = Provider.make({
    id: memoryProviderId,
    scope: "switchable",
    resolveMany: (requests, context) =>
      Effect.suspend(() => {
        state.interactive.push(context.interactive);

        return state.down
          ? Effect.fail(
              new ProviderError({
                reason: ProviderFailure.Unavailable,
                provider: memoryProviderId,
                detail: "The test provider is down.",
              }),
            )
          : Effect.succeed(
              Object.fromEntries(requests.map((request) => [request.key, Result.succeed("1")])),
            );
      }),
    helpers: {},
  });

  return { state, oneConfig: defineConfig({ providers: [source], vars: { A: mem("a") } }) };
};

describe("the overrides of a client", () => {
  it("wins over ENVI_INTERACTIVE", async () => {
    vi.stubEnv("ENVI_INTERACTIVE", "true");

    const { state, oneConfig } = switchable();
    const envi = createEnvi(oneConfig, { cache: false, interactive: false });

    await envi.load();
    await envi.dispose();

    expect(state.interactive).toEqual([false]);
  });

  it("wins over ENVI_STRICT for the stale fallback", async () => {
    vi.stubEnv("ENVI_STRICT", "true");

    const { state, oneConfig } = switchable();
    // With a ttl of 0, every entry has expired at the next load.
    const cache = { directory: cacheDirectory(), encryption: "none", ttl: 0 } as const;
    const lenient = createEnvi(oneConfig, { cache, strict: false });
    const strict = createEnvi(oneConfig, { cache, strict: true });

    await lenient.load();
    state.down = true;

    expect(await lenient.load()).toEqual({ A: "1" });
    await expect(strict.load()).rejects.toBeInstanceOf(VarsError);
    await lenient.dispose();
    await strict.dispose();
  });
});

describe("the cache of a sync report", () => {
  /** The environment of the default layer: a temp home and a key from `ENVI_CACHE_KEY`. */
  const environment = () => withEnv({ HOME: cacheDirectory(), ENVI_CACHE_KEY: "a test key" });

  it.each([
    { cache: false as const, reported: false },
    { cache: undefined, reported: true },
  ])("is $reported for a config with `cache: $cache`", async ({ cache, reported }) => {
    const { oneConfig } = oneSecret(cache);

    const report = await Effect.runPromise(
      Envi.Envi.use((envi) => envi.sync(oneConfig)).pipe(Effect.provide(layer()), environment()),
    );

    expect(report.cache).toBe(reported);
  });

  it("is true for the in-memory cache in CI, and the next load reads it", async () => {
    const { secrets, oneConfig } = oneSecret();

    const program = Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const report = yield* envi.sync(oneConfig);

      yield* envi.load(oneConfig);

      return report;
    });

    const report = await Effect.runPromise(
      program.pipe(Effect.provide(enviLayer()), withEnv({ CI: "true" })),
    );

    expect(report.cache).toBe(true);
    expect(secrets.calls().length).toBe(1);
  });
});
