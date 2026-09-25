import { assert, describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import * as Cache from "./Cache.ts";
import {
  CustomError,
  CustomFailure,
  CustomReason,
  DecodeError,
  DeriveError,
  ProviderError,
  ProviderFailure,
  ReferenceError,
  ReferenceFailure,
} from "./Errors.ts";
import { mem, memoryProvider, type MemoryProvider } from "./Memory.ts";
import * as Provider from "./Provider.ts";
import { ValueOrigin } from "./Reports.ts";
import * as Resolver from "./Resolver.ts";
import * as Source from "./Source.ts";

const options: Resolver.Options = {
  stage: "development",
  refresh: false,
  strict: false,
  interactive: true,
  ttl: "24 hours",
  maxStale: "7 days",
};

const layerWith = (...providers: ReadonlyArray<Provider.Provider>) =>
  Layer.mergeAll(Cache.layerMemory, Provider.layer(providers));

const succeeded = (resolution: Resolver.Resolution, key: string): Resolver.Resolved => {
  const outcome = resolution.vars[key];

  assert(outcome !== undefined && Result.isSuccess(outcome), `expected ${key} to resolve`);

  return outcome.success;
};

const failed = (resolution: Resolver.Resolution, key: string): Resolver.VarError => {
  const outcome = resolution.vars[key];

  assert(outcome !== undefined && Result.isFailure(outcome), `expected ${key} to fail`);

  return outcome.failure;
};

const rawOf = (resolved: Resolver.Resolved): string | undefined =>
  Option.getOrUndefined(Option.map(resolved.raw, Redacted.value));

/** A provider that fails as a whole while `down` holds `true`. */
const flakyProvider = (down: Ref.Ref<boolean>, memory: MemoryProvider) =>
  Provider.make({
    id: "flaky",
    Reference: Schema.String,
    describe: (key) => `flaky://${key}`,
    scope: "test",
    resolveMany: (requests, context) =>
      Effect.flatMap(Ref.get(down), (isDown) =>
        isDown
          ? Effect.fail(
              new ProviderError({
                reason: ProviderFailure.Unavailable,
                provider: "flaky",
                detail: "The test provider is down.",
              }),
            )
          : memory.resolveMany(requests, context).pipe(Effect.orDie),
      ),
    helpers: {},
  });

describe("Resolver", () => {
  it.effect("resolves literals and references in one provider call", () => {
    const memory = memoryProvider({ "db/url": "postgres://localhost/app", port: "5432" });

    return Effect.gen(function* () {
      const resolution = yield* Resolver.resolve(
        {
          NODE_ENV: Source.value("development"),
          DATABASE_URL: mem("db/url"),
          DB_PORT: mem("port").schema(Schema.FiniteFromString),
        },
        options,
      );

      expect(succeeded(resolution, "NODE_ENV").decoded).toBe("development");
      expect(succeeded(resolution, "NODE_ENV").origin).toBe(ValueOrigin.Literal);
      expect(succeeded(resolution, "DB_PORT").decoded).toBe(5432);
      expect(rawOf(succeeded(resolution, "DB_PORT"))).toBe("5432");
      expect(succeeded(resolution, "DATABASE_URL").origin).toBe(ValueOrigin.Provider);
      expect(succeeded(resolution, "DATABASE_URL").reference).toEqual(
        Option.some("memory://db/url"),
      );
      expect(memory.calls()).toEqual([["db/url", "port"]]);
    }).pipe(Effect.provide(layerWith(memory)));
  });

  it.effect("fetches a shared reference once", () => {
    const memory = memoryProvider({ a: "1" });

    return Effect.gen(function* () {
      yield* Resolver.resolve({ FIRST: mem("a"), SECOND: mem("a") }, options);

      expect(memory.calls()).toEqual([["a"]]);
    }).pipe(Effect.provide(layerWith(memory)));
  });

  it.effect("reads the cache on the second call and reports the counts", () => {
    const memory = memoryProvider({ a: "1" });

    return Effect.gen(function* () {
      const first = yield* Resolver.resolve({ A: mem("a") }, options);
      const second = yield* Resolver.resolve({ A: mem("a") }, options);

      expect(memory.calls()).toHaveLength(1);
      expect(succeeded(second, "A").origin).toBe(ValueOrigin.Cache);
      expect(first.providers).toEqual([{ provider: "memory", secrets: 1, cached: 0, resolved: 1 }]);
      expect(second.providers).toEqual([
        { provider: "memory", secrets: 1, cached: 1, resolved: 0 },
      ]);
    }).pipe(Effect.provide(layerWith(memory)));
  });

  it.effect("calls the provider again for refresh, for cache(false), and after the TTL", () => {
    const memory = memoryProvider({ a: "1" });

    return Effect.gen(function* () {
      yield* Resolver.resolve({ A: mem("a") }, options);
      yield* Resolver.resolve({ A: mem("a") }, { ...options, refresh: true });

      expect(memory.calls()).toHaveLength(2);

      yield* Resolver.resolve({ A: mem("a").cache(false) }, options);

      expect(memory.calls()).toHaveLength(3);

      yield* TestClock.adjust("25 hours");
      yield* Resolver.resolve({ A: mem("a") }, options);

      expect(memory.calls()).toHaveLength(4);
    }).pipe(Effect.provide(layerWith(memory)));
  });

  it.effect("uses the TTL of the descriptor", () => {
    const memory = memoryProvider({ a: "1" });

    return Effect.gen(function* () {
      const short = mem("a").cache({ ttl: "1 hour" });

      yield* Resolver.resolve({ A: short }, options);
      yield* TestClock.adjust("2 hours");
      yield* Resolver.resolve({ A: short }, options);

      expect(memory.calls()).toHaveLength(2);
    }).pipe(Effect.provide(layerWith(memory)));
  });

  it.effect("applies optional and default only to a missing reference", () =>
    Effect.gen(function* () {
      const resolution = yield* Resolver.resolve(
        {
          OPTIONAL: mem("missing").optional(),
          DEFAULTED: mem("missing").schema(Schema.FiniteFromString).default("7"),
          REQUIRED: mem("missing"),
        },
        options,
      );

      expect(succeeded(resolution, "OPTIONAL").decoded).toBeUndefined();
      expect(succeeded(resolution, "OPTIONAL").origin).toBe(ValueOrigin.Unset);
      expect(succeeded(resolution, "DEFAULTED").decoded).toBe(7);
      expect(succeeded(resolution, "DEFAULTED").origin).toBe(ValueOrigin.Default);

      const error = failed(resolution, "REQUIRED");

      expect(error).toBeInstanceOf(ReferenceError);
      expect(error).toMatchObject({
        reason: ReferenceFailure.NotFound,
        reference: "memory://missing",
      });
    }).pipe(Effect.provide(layerWith(memoryProvider({})))),
  );

  it.effect("fails one var for an unknown provider and for a value that does not decode", () =>
    Effect.gen(function* () {
      const resolution = yield* Resolver.resolve(
        {
          UNKNOWN: Source.reference("vault", "x"),
          BAD: mem("word").schema(Schema.FiniteFromString),
          GOOD: mem("word"),
        },
        options,
      );

      expect(failed(resolution, "UNKNOWN")).toMatchObject({
        reason: ProviderFailure.UnknownProvider,
      });
      expect(failed(resolution, "BAD")).toBeInstanceOf(DecodeError);
      expect(failed(resolution, "BAD")).toMatchObject({ key: "BAD" });
      expect(succeeded(resolution, "GOOD").decoded).toBe("hello");
    }).pipe(Effect.provide(layerWith(memoryProvider({ word: "hello" })))),
  );

  it.effect("reads fromEnv through the config provider", () =>
    Effect.gen(function* () {
      const resolution = yield* Resolver.resolve(
        { SHA: Source.fromEnv("GITHUB_SHA"), NONE: Source.fromEnv("NOT_SET").default("local") },
        options,
      );

      expect(succeeded(resolution, "SHA").decoded).toBe("abc123");
      expect(succeeded(resolution, "SHA").origin).toBe(ValueOrigin.Environment);
      expect(succeeded(resolution, "NONE").decoded).toBe("local");
    }).pipe(
      Effect.provide(layerWith()),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ GITHUB_SHA: "abc123" }))),
    ),
  );

  it.effect(
    "resolves the inputs of custom and derive in the same batch, and nests them in order",
    () => {
      const memory = memoryProvider({ user: "app", password: "pw", port: "5432" });

      return Effect.gen(function* () {
        const user = mem("user");

        const authority = Source.derive(
          { user, password: mem("password") },
          (inputs) => `${inputs.user}:${inputs.password}`,
        );

        const resolution = yield* Resolver.resolve(
          {
            DB_USER: user,
            DATABASE_URL: Source.custom({
              id: "database-url",
              from: { authority, port: mem("port").schema(Schema.FiniteFromString) },
              resolve: (inputs) => `postgres://${inputs.authority}@db:${inputs.port}/app`,
            }),
          },
          options,
        );

        expect(succeeded(resolution, "DATABASE_URL").decoded).toBe("postgres://app:pw@db:5432/app");
        expect(succeeded(resolution, "DATABASE_URL").origin).toBe(ValueOrigin.Custom);
        expect(memory.calls()).toHaveLength(1);
        expect(new Set(memory.calls()[0])).toEqual(new Set(["user", "password", "port"]));
      }).pipe(Effect.provide(layerWith(memory)));
    },
  );

  it.effect("derives a value on every run, and applies optional and default to undefined", () => {
    const secrets = { port: "5432" };
    const memory = memoryProvider(secrets);

    return Effect.gen(function* () {
      const port = mem("port").cache(false).schema(Schema.FiniteFromString);

      const sources = {
        NEXT_PORT: Source.derive(port, (value) => String(value + 1)),
        NONE: Source.derive(port, () => undefined).optional(),
        FALLBACK: Source.derive(port, () => undefined).default("fallback"),
        REQUIRED: Source.derive(port, () => undefined),
      };

      const first = yield* Resolver.resolve(sources, options);

      secrets.port = "6000";

      const second = yield* Resolver.resolve(sources, options);

      expect(succeeded(first, "NEXT_PORT")).toMatchObject({
        decoded: "5433",
        origin: ValueOrigin.Derived,
      });
      expect(succeeded(second, "NEXT_PORT").decoded).toBe("6001");
      expect(succeeded(first, "NONE").origin).toBe(ValueOrigin.Unset);
      expect(succeeded(first, "FALLBACK").decoded).toBe("fallback");
      expect(failed(first, "REQUIRED")).toMatchObject({ reason: ReferenceFailure.NotFound });

      const entries = yield* Effect.flatMap(Cache.Cache, (cache) => cache.list());

      expect(entries).toEqual([]);
    }).pipe(Effect.provide(layerWith(memory)));
  });

  it.effect("fails a derive that throws with a DeriveError", () =>
    Effect.gen(function* () {
      const resolution = yield* Resolver.resolve(
        {
          BROKEN: Source.derive(mem("a"), () => {
            throw new Error("fake-secret-in-message");
          }),
        },
        options,
      );

      expect(failed(resolution, "BROKEN")).toBeInstanceOf(DeriveError);
    }).pipe(Effect.provide(layerWith(memoryProvider({ a: "1" })))),
  );

  it.effect("caches a custom value, and computes it again when an input changes", () => {
    const secrets = { secret: "s" };
    const memory = memoryProvider(secrets);

    return Effect.gen(function* () {
      const runs = yield* Ref.make(0);

      const token = Source.custom({
        id: "api-token",
        from: { secret: mem("secret").cache(false) },
        resolve: (inputs) =>
          Effect.as(
            Ref.update(runs, (count) => count + 1),
            `t-${inputs.secret}`,
          ),
      });

      yield* Resolver.resolve({ TOKEN: token }, options);

      const second = yield* Resolver.resolve({ TOKEN: token }, options);

      expect(succeeded(second, "TOKEN").decoded).toBe("t-s");
      expect(succeeded(second, "TOKEN").origin).toBe(ValueOrigin.Cache);
      expect(yield* Ref.get(runs)).toBe(1);

      secrets.secret = "rotated";

      const third = yield* Resolver.resolve({ TOKEN: token }, options);

      expect(succeeded(third, "TOKEN").decoded).toBe("t-rotated");
      expect(succeeded(third, "TOKEN").origin).toBe(ValueOrigin.Custom);
      expect(yield* Ref.get(runs)).toBe(2);
      expect(memory.calls()).toHaveLength(3);

      const entries = yield* Effect.flatMap(Cache.Cache, (cache) => cache.list());

      expect(entries.map((entry) => entry.reference)).toEqual(["custom(api-token)"]);
    }).pipe(Effect.provide(layerWith(memory)));
  });

  it.effect("keeps one custom entry for each stage, and never for cache(false)", () =>
    Effect.gen(function* () {
      const runs = yield* Ref.make(0);

      const counted = Source.custom({
        id: "build-number",
        resolve: () =>
          Effect.as(
            Ref.update(runs, (count) => count + 1),
            "42",
          ),
      });

      yield* Resolver.resolve({ BUILD: counted }, options);
      yield* Resolver.resolve({ BUILD: counted }, { ...options, stage: "production" });
      yield* Resolver.resolve({ BUILD: counted }, options);

      expect(yield* Ref.get(runs)).toBe(2);

      yield* Resolver.resolve({ BUILD: counted.cache(false) }, options);
      yield* Resolver.resolve({ BUILD: counted }, { ...options, refresh: true });

      expect(yield* Ref.get(runs)).toBe(4);
    }).pipe(Effect.provide(layerWith())),
  );

  it.effect("fails the var when a custom input fails", () =>
    Effect.gen(function* () {
      const resolution = yield* Resolver.resolve(
        {
          URL: Source.custom({
            id: "url",
            from: { user: mem("missing") },
            resolve: (inputs) => inputs.user,
          }),
        },
        options,
      );

      expect(failed(resolution, "URL")).toMatchObject({ reason: ReferenceFailure.NotFound });
    }).pipe(Effect.provide(layerWith(memoryProvider({})))),
  );

  it.effect("uses an expired custom entry of the same inputs after a transient CustomFailure", () =>
    Effect.gen(function* () {
      const down = yield* Ref.make(false);

      const token = (transient: boolean) =>
        Source.custom({
          id: "token",
          resolve: () =>
            Effect.flatMap(Ref.get(down), (isDown) =>
              isDown
                ? Effect.fail(
                    new CustomFailure({ message: "The token service is down.", transient }),
                  )
                : Effect.succeed("t-1"),
            ),
        });

      yield* Resolver.resolve({ TOKEN: token(true) }, options);
      yield* Ref.set(down, true);
      yield* TestClock.adjust("2 days");

      const stale = yield* Resolver.resolve({ TOKEN: token(true) }, options);

      expect(succeeded(stale, "TOKEN")).toMatchObject({
        decoded: "t-1",
        origin: ValueOrigin.StaleCache,
      });
      expect(
        failed(
          yield* Resolver.resolve({ TOKEN: token(true) }, { ...options, strict: true }),
          "TOKEN",
        ),
      ).toMatchObject({
        reason: CustomReason.Failed,
        detail: "The token service is down.",
      });
    }).pipe(Effect.provide(layerWith())),
  );

  it.effect("uses no expired custom entry after a failure that is not transient", () =>
    Effect.gen(function* () {
      const down = yield* Ref.make(false);

      const token = Source.custom({
        id: "token",
        resolve: () =>
          Effect.flatMap(Ref.get(down), (isDown) =>
            isDown ? Effect.fail(new Error("fake-secret")) : Effect.succeed("t-1"),
          ),
      });

      yield* Resolver.resolve({ TOKEN: token }, options);
      yield* Ref.set(down, true);
      yield* TestClock.adjust("2 days");

      const error = failed(yield* Resolver.resolve({ TOKEN: token }, options), "TOKEN");

      expect(error).toBeInstanceOf(CustomError);
      expect(error).toMatchObject({ reason: CustomReason.Threw, id: "token" });
    }).pipe(Effect.provide(layerWith())),
  );

  it.effect("uses an expired entry after a transient failure, unless strict or too old", () => {
    const memory = memoryProvider({ a: "1" });

    return Effect.gen(function* () {
      const down = yield* Ref.make(false);
      const flaky = flakyProvider(down, memory);
      const sources = { A: Source.reference("flaky", "a") };

      const run = (overrides: Partial<Resolver.Options>) =>
        Resolver.resolve(sources, { ...options, ...overrides }).pipe(
          Effect.provide(Provider.layer([flaky])),
        );

      yield* run({});
      yield* Ref.set(down, true);
      yield* TestClock.adjust("2 days");

      const stale = yield* run({});

      expect(succeeded(stale, "A").decoded).toBe("1");
      expect(succeeded(stale, "A").origin).toBe(ValueOrigin.StaleCache);
      expect(failed(yield* run({ strict: true }), "A")).toMatchObject({
        reason: ProviderFailure.Unavailable,
      });

      yield* TestClock.adjust("6 days");

      expect(failed(yield* run({}), "A")).toMatchObject({ reason: ProviderFailure.Unavailable });
    }).pipe(Effect.provide(Cache.layerMemory));
  });

  it.effect(
    "gives a value from an expired input the stale origin, and caches a custom value safely",
    () => {
      const memory = memoryProvider({ a: "1" });

      return Effect.gen(function* () {
        const down = yield* Ref.make(false);
        const runs = yield* Ref.make(0);
        const flaky = flakyProvider(down, memory);
        const input = Source.reference("flaky", "a");

        const sources = {
          DERIVED: Source.derive(input, (a) => `derived-${a}`),
          CUSTOM: Source.custom({
            id: "custom",
            from: { a: input },
            resolve: ({ a }) =>
              Effect.as(
                Ref.update(runs, (count) => count + 1),
                `custom-${a}`,
              ),
          }),
        };

        const run = (overrides: Partial<Resolver.Options>) =>
          Resolver.resolve(sources, { ...options, ...overrides }).pipe(
            Effect.provide(Provider.layer([flaky])),
          );

        yield* run({});
        yield* Ref.set(down, true);
        yield* TestClock.adjust("2 days");

        const stale = yield* run({});

        expect(succeeded(stale, "DERIVED")).toMatchObject({
          decoded: "derived-1",
          origin: ValueOrigin.StaleCache,
        });
        expect(succeeded(stale, "CUSTOM")).toMatchObject({
          decoded: "custom-1",
          origin: ValueOrigin.StaleCache,
        });
        expect(yield* Ref.get(runs)).toBe(2);

        // The entry of the stale run belongs to the input value "1", so a fresh "1" reuses it.
        yield* Ref.set(down, false);

        const fresh = yield* run({ refresh: false });

        expect(succeeded(fresh, "CUSTOM").origin).toBe(ValueOrigin.Cache);
        expect(yield* Ref.get(runs)).toBe(2);
      }).pipe(Effect.provide(Cache.layerMemory));
    },
  );

  it.effect("rejects a provider response without the requested key", () => {
    const broken = Provider.make({
      id: "broken",
      Reference: Schema.String,
      describe: (key) => `broken://${key}`,
      scope: "test",
      resolveMany: () => Effect.succeed({}),
      helpers: {},
    });

    return Effect.gen(function* () {
      const resolution = yield* Resolver.resolve({ A: Source.reference("broken", "a") }, options);

      expect(failed(resolution, "A")).toMatchObject({ reason: ProviderFailure.InvalidResponse });
    }).pipe(Effect.provide(layerWith(broken)));
  });

  it.effect("keeps the entries of two provider instances with one id apart", () => {
    const web = memoryProvider({ "api-key": "fake-web-key" });
    const api = memoryProvider({ "api-key": "fake-api-key" });
    const sources = { API_KEY: mem("api-key") };

    return Effect.gen(function* () {
      const first = yield* Resolver.resolve(sources, options).pipe(
        Effect.provide(Provider.layer([web])),
      );

      const second = yield* Resolver.resolve(sources, options).pipe(
        Effect.provide(Provider.layer([api])),
      );

      expect(succeeded(first, "API_KEY").decoded).toBe("fake-web-key");
      expect(succeeded(second, "API_KEY").decoded).toBe("fake-api-key");
    }).pipe(Effect.provide(Cache.layerMemory));
  });

  it.effect("puts only a hash of the scope into a cache key", () => {
    const scoped = Provider.make({
      id: "scoped",
      Reference: Schema.String,
      describe: (key) => `scoped://${key}`,
      scope: "fake-credential-in-scope",
      resolveMany: (requests) =>
        Effect.succeed(
          Object.fromEntries(requests.map((request) => [request.key, Result.succeed("value")])),
        ),
      helpers: {},
    });

    return Effect.gen(function* () {
      yield* Resolver.resolve({ A: Source.reference("scoped", "a") }, options);

      const entries = yield* Effect.flatMap(Cache.Cache, (cache) => cache.list());

      expect(entries).toHaveLength(1);
      expect(entries[0]?.key).not.toContain("fake-credential-in-scope");
      expect(entries[0]?.key).toMatch(/^scoped:[0-9a-f]{16}:scoped:\/\/a$/u);
    }).pipe(Effect.provide(layerWith(scoped)));
  });

  it.effect("caches a missing value of an optional var, so a warm run calls no provider", () => {
    const memory = memoryProvider({});
    const sources = { SENTRY_DSN: mem("sentry").optional(), LOG_LEVEL: mem("log").default("info") };

    return Effect.gen(function* () {
      yield* Resolver.resolve(sources, options);

      const warm = yield* Resolver.resolve(sources, options);

      expect(memory.calls()).toHaveLength(1);
      expect(succeeded(warm, "SENTRY_DSN").origin).toBe(ValueOrigin.Unset);
      expect(succeeded(warm, "LOG_LEVEL")).toMatchObject({
        decoded: "info",
        origin: ValueOrigin.Default,
      });
    }).pipe(Effect.provide(layerWith(memory)));
  });

  it.effect("never trusts a cached missing value for a required var", () => {
    const memory = memoryProvider({});

    return Effect.gen(function* () {
      yield* Resolver.resolve({ OPTIONAL: mem("token").optional() }, options);

      const required = yield* Resolver.resolve({ REQUIRED: mem("token") }, options);

      expect(memory.calls()).toHaveLength(2);
      expect(failed(required, "REQUIRED")).toMatchObject({ reason: ReferenceFailure.NotFound });
    }).pipe(Effect.provide(layerWith(memory)));
  });

  it.effect("asks the provider again for a cached missing value on refresh", () => {
    const memory = memoryProvider({});
    const sources = { OPTIONAL: mem("token").optional() };

    return Effect.gen(function* () {
      yield* Resolver.resolve(sources, options);
      yield* Resolver.resolve(sources, { ...options, refresh: true });

      expect(memory.calls()).toHaveLength(2);
    }).pipe(Effect.provide(layerWith(memory)));
  });
});
