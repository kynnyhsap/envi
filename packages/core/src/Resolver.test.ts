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
  DecodeError,
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
    cacheKey: (key) => key,
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
    "resolves the inputs of custom in the same batch and runs nested customs in order",
    () => {
      const memory = memoryProvider({ user: "app", password: "pw", port: "5432" });

      return Effect.gen(function* () {
        const user = mem("user");

        const authority = Source.custom({
          from: { user, password: mem("password") },
          resolve: (inputs) => `${inputs.user}:${inputs.password}`,
        });

        const resolution = yield* Resolver.resolve(
          {
            DB_USER: user,
            DATABASE_URL: Source.custom({
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

  it.effect("caches a custom value with a key and skips its inputs on a hit", () => {
    const memory = memoryProvider({ secret: "s" });

    return Effect.gen(function* () {
      const runs = yield* Ref.make(0);

      const token = Source.custom({
        key: "api-token",
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
      expect(memory.calls()).toHaveLength(1);
    }).pipe(Effect.provide(layerWith(memory)));
  });

  it.effect("fails the var when a custom input fails", () =>
    Effect.gen(function* () {
      const resolution = yield* Resolver.resolve(
        {
          URL: Source.custom({ from: { user: mem("missing") }, resolve: (inputs) => inputs.user }),
        },
        options,
      );

      expect(failed(resolution, "URL")).toMatchObject({ reason: ReferenceFailure.NotFound });
    }).pipe(Effect.provide(layerWith(memoryProvider({})))),
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

  it.effect("never caches a custom value that comes from an expired input", () => {
    const memory = memoryProvider({ a: "1" });

    return Effect.gen(function* () {
      const down = yield* Ref.make(false);
      const flaky = flakyProvider(down, memory);

      const sources = {
        DERIVED: Source.custom({
          key: "derived",
          from: { a: Source.reference("flaky", "a") },
          resolve: ({ a }) => `value-${a}`,
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

      expect(succeeded(stale, "DERIVED").decoded).toBe("value-1");
      expect(succeeded(stale, "DERIVED").origin).toBe(ValueOrigin.StaleCache);

      // The stale run wrote no fresh entry, so a strict run has nothing to trust.
      expect(failed(yield* run({ strict: true }), "DERIVED")).toMatchObject({
        reason: ProviderFailure.Unavailable,
      });
    }).pipe(Effect.provide(Cache.layerMemory));
  });

  it.effect("rejects a provider response without the requested key", () => {
    const broken = Provider.make({
      id: "broken",
      Reference: Schema.String,
      describe: (key) => `broken://${key}`,
      cacheKey: (key) => key,
      resolveMany: () => Effect.succeed({}),
      helpers: {},
    });

    return Effect.gen(function* () {
      const resolution = yield* Resolver.resolve({ A: Source.reference("broken", "a") }, options);

      expect(failed(resolution, "A")).toMatchObject({ reason: ProviderFailure.InvalidResponse });
    }).pipe(Effect.provide(layerWith(broken)));
  });
});
