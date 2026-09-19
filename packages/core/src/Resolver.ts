import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import type * as Schema from "effect/Schema";

import * as Cache from "./Cache.ts";
import {
  type CacheError,
  type DecodeError,
  ProviderError,
  ProviderFailure,
  ReferenceError,
  ReferenceFailure,
} from "./Errors.ts";
import * as Provider from "./Provider.ts";
import { ValueOrigin } from "./Reports.ts";
import * as Source from "./Source.ts";
import * as Timing from "./Timing.ts";

/** The settings of one resolution. The caller applies the precedence order before it calls. */
export interface Options {
  /** Ignores fresh cache entries. A stale entry still serves the fallback. */
  readonly refresh: boolean;
  /** Disables the stale fallback. CI is always strict. */
  readonly strict: boolean;
  readonly interactive: boolean;
  readonly ttl: Duration.Input;
  readonly maxStale: Duration.Input;
}

/** The failure of one var. A cache failure is not one: it fails the whole resolution. */
export type VarError = ReferenceError | ProviderError | DecodeError;

/** One resolved var. `raw` is absent for an optional var without a value. */
export interface Resolved {
  readonly raw: Option.Option<Redacted.Redacted>;
  readonly decoded: unknown;
  readonly origin: ValueOrigin;
  readonly provider: Option.Option<string>;
  /** The `describe()` text. It never holds a secret. */
  readonly reference: Option.Option<string>;
  readonly resolvedAt: Option.Option<number>;
  readonly isRedacted: boolean;
}

/** The provider counts of one resolution. `sync` reports them. */
export interface ProviderCounts {
  readonly provider: string;
  readonly secrets: number;
  readonly cached: number;
  readonly resolved: number;
}

/** The result of one resolution: one outcome for each var, plus the provider counts. */
export interface Resolution {
  readonly vars: Readonly<Record<string, Result.Result<Resolved, VarError>>>;
  readonly providers: ReadonlyArray<ProviderCounts>;
}

/** The id under which `fromEnv` values appear in reports and errors. */
export const environmentProviderId = "environment";

interface Leaf {
  readonly fullKey: string;
  readonly provider: Provider.Provider;
  readonly reference: Schema.Json;
  readonly description: string;
}

interface Evaluated {
  readonly raw: Option.Option<Redacted.Redacted>;
  readonly origin: ValueOrigin;
  readonly provider: Option.Option<string>;
  readonly reference: Option.Option<string>;
  readonly resolvedAt: Option.Option<number>;
}

const isCustom = Source.Origin.$is("Custom");

const isReference = Source.Origin.$is("Reference");

const isCacheDisabled = Source.CachePolicy.$is("Disabled");

const customKeyOf = (key: string): string => `${Source.customProviderId}:${key}`;

const isTransient = (error: VarError | CacheError): error is ProviderError =>
  Predicate.isTagged(error, "ProviderError") && error.reason === ProviderFailure.Unavailable;

const invalidResponse = (provider: string, detail: string): ProviderError =>
  new ProviderError({ reason: ProviderFailure.InvalidResponse, provider, detail });

const fromRecord = (found: Cache.CacheRecord, origin: ValueOrigin): Evaluated => ({
  raw: Option.some(found.value),
  origin,
  provider: Option.some(found.provider),
  reference: Option.some(found.reference),
  resolvedAt: Option.some(found.resolvedAt),
});

const whenMissing = (
  source: Source.AnySource,
  provider: string,
  reference: string,
): Effect.Effect<Evaluated, VarError> => {
  const base = {
    provider: Option.some(provider),
    reference: Option.some(reference),
    resolvedAt: Option.none(),
  };

  if (Option.isSome(source.fallback)) {
    return Effect.succeed({
      ...base,
      raw: Option.some(Redacted.make(source.fallback.value)),
      origin: ValueOrigin.Default,
    });
  }

  return source.isOptional
    ? Effect.succeed({ ...base, raw: Option.none(), origin: ValueOrigin.Unset })
    : Effect.fail(new ReferenceError({ reason: ReferenceFailure.NotFound, provider, reference }));
};

/**
 * Resolves a record of descriptors: one cache read, one call for each provider, then the
 * `custom()` values from the inside to the outside.
 *
 * @returns One outcome for each var. Only a cache failure fails the whole effect.
 */
export const resolve = Effect.fn("Resolver.resolve")(function* (
  sources: Readonly<Record<string, Source.AnySource>>,
  options: Options,
) {
  const cache = yield* Cache.Cache;
  const providers = yield* Provider.Providers;
  const now = yield* Clock.currentTimeMillis;

  // 1. Walk every descriptor, including the inputs of each custom(), and prepare the references.
  const all = new Set<Source.AnySource>();
  const leaves = new Map<Source.AnySource, Result.Result<Leaf, VarError>>();

  const collect = (source: Source.AnySource): void => {
    if (all.has(source)) {
      return;
    }

    all.add(source);

    if (isCustom(source.origin)) {
      source.origin.inputs.forEach(collect);
    }
  };

  Object.values(sources).forEach(collect);

  for (const source of all) {
    if (isReference(source.origin)) {
      const { provider: providerId, reference } = source.origin;

      leaves.set(
        source,
        yield* Effect.result(
          Effect.gen(function* () {
            const provider = yield* providers.get(providerId);
            const prepared = yield* provider.prepare(reference);

            return {
              fullKey: `${provider.id}:${prepared.cacheKey}`,
              provider,
              reference,
              description: prepared.description,
            };
          }),
        ),
      );
    }
  }

  const cacheKeyOf = (source: Source.AnySource): Option.Option<string> => {
    if (isCustom(source.origin)) {
      return Option.map(source.origin.key, customKeyOf);
    }

    const leaf = leaves.get(source);

    return leaf !== undefined && Result.isSuccess(leaf)
      ? Option.some(leaf.success.fullKey)
      : Option.none();
  };

  // 2. One cache read for every key that can have an entry.
  const cacheKeys = [...new Set([...all].flatMap((source) => Option.toArray(cacheKeyOf(source))))];

  const cached = yield* cache
    .getMany(cacheKeys)
    .pipe(Timing.measure("cache.read", { references: cacheKeys.length }));

  const durations = (source: Source.AnySource) =>
    Source.CachePolicy.$match(source.cachePolicy, {
      Inherit: () => ({ ttl: options.ttl, maxStale: options.maxStale }),
      Disabled: () => ({ ttl: Duration.zero, maxStale: options.maxStale }),
      Override: (policy) => ({
        ttl: Option.getOrElse(policy.ttl, () => options.ttl),
        maxStale: Option.getOrElse(policy.maxStale, () => options.maxStale),
      }),
    });

  const recordOf = (source: Source.AnySource): Option.Option<Cache.CacheRecord> =>
    Option.flatMap(cacheKeyOf(source), (key) => Option.fromUndefinedOr(cached[key]));

  const freshRecord = (
    source: Source.AnySource,
    records: Cache.CacheRecords,
  ): Option.Option<Cache.CacheRecord> =>
    options.refresh
      ? Option.none()
      : cacheKeyOf(source).pipe(
          Option.flatMap((key) => Option.fromUndefinedOr(records[key])),
          Option.filter(
            (found) => now - found.resolvedAt < Duration.toMillis(durations(source).ttl),
          ),
        );

  const staleRecord = (source: Source.AnySource): Option.Option<Cache.CacheRecord> =>
    options.strict
      ? Option.none()
      : Option.filter(
          recordOf(source),
          (found) => now - found.resolvedAt < Duration.toMillis(durations(source).maxStale),
        );

  // 3. The references that need a provider call. A fresh custom() hides its inputs.
  const reachable = new Set<Source.AnySource>();
  const visited = new Set<Source.AnySource>();

  const visit = (source: Source.AnySource): void => {
    if (visited.has(source)) {
      return;
    }

    visited.add(source);

    if (isReference(source.origin)) {
      reachable.add(source);
    }

    if (isCustom(source.origin) && Option.isNone(freshRecord(source, cached))) {
      source.origin.inputs.forEach(visit);
    }
  };

  Object.values(sources).forEach(visit);

  const leafOf = (source: Source.AnySource): Option.Option<Leaf> => {
    const leaf = leaves.get(source);

    return leaf !== undefined && Result.isSuccess(leaf) ? Option.some(leaf.success) : Option.none();
  };

  const misses = (records: Cache.CacheRecords): ReadonlyArray<Leaf> => [
    ...new Map(
      [...reachable]
        .filter((source) => Option.isNone(freshRecord(source, records)))
        .flatMap((source) => Option.toArray(leafOf(source)))
        .map((leaf) => [leaf.fullKey, leaf] as const),
    ).values(),
  ];

  // 4. One call for each provider, under the resolve lock, after a second cache read.
  const fetched = new Map<string, Result.Result<string, VarError>>();

  const fetchFrom = (provider: Provider.Provider, wanted: ReadonlyArray<Leaf>) =>
    Effect.logDebug("Envi calls a provider with one batch.").pipe(
      Effect.annotateLogs({
        provider: provider.id,
        references: wanted.map((leaf) => leaf.description).join(", "),
      }),
      Effect.andThen(fetchBatch(provider, wanted)),
    );

  const fetchBatch = (provider: Provider.Provider, wanted: ReadonlyArray<Leaf>) =>
    provider
      .resolveMany(
        wanted.map((leaf) => ({ key: leaf.fullKey, reference: leaf.reference })),
        { interactive: options.interactive },
      )
      .pipe(
        Effect.flatMap((results) => {
          const unknownKey = Object.keys(results).find(
            (key) => !wanted.some((leaf) => leaf.fullKey === key),
          );

          return unknownKey === undefined
            ? Effect.succeed(results)
            : Effect.fail(invalidResponse(provider.id, "The provider returned an unknown key."));
        }),
        Effect.tapError((error) =>
          Effect.logDebug("A provider call failed.").pipe(
            Effect.annotateLogs({ provider: provider.id, error: error.message }),
          ),
        ),
        Timing.measure("provider.resolve", { provider: provider.id, references: wanted.length }),
        Effect.result,
        Effect.map((outcome) => {
          for (const leaf of wanted) {
            fetched.set(
              leaf.fullKey,
              Result.match(outcome, {
                onFailure: (error) => Result.fail(error),
                onSuccess: (results) => {
                  const result = results[leaf.fullKey];

                  if (result === undefined) {
                    return Result.fail(
                      invalidResponse(provider.id, "The provider returned no result for a key."),
                    );
                  }

                  return Result.mapError(
                    result,
                    (reason) =>
                      new ReferenceError({
                        reason,
                        provider: provider.id,
                        reference: leaf.description,
                      }),
                  );
                },
              }),
            );
          }
        }),
      );

  let afterLock = cached;

  yield* Effect.logDebug("Envi read the cache.").pipe(
    Effect.annotateLogs({ references: cacheKeys.length, misses: misses(cached).length }),
  );

  if (misses(cached).length > 0) {
    // The time of this step includes the wait for the lock.
    yield* cache
      .withResolveLock(
        Effect.gen(function* () {
          afterLock = options.refresh
            ? cached
            : { ...cached, ...(yield* cache.getMany(cacheKeys)) };

          const wanted = misses(afterLock);
          const byProvider = Arr.groupBy(wanted, (leaf) => leaf.provider.id);

          yield* Effect.forEach(
            Object.values(byProvider),
            (providerLeaves) => fetchFrom(providerLeaves[0].provider, providerLeaves),
            { concurrency: "unbounded", discard: true },
          );

          const cacheable = new Set(
            [...reachable]
              .filter((source) => !isCacheDisabled(source.cachePolicy))
              .flatMap((source) => Option.toArray(leafOf(source)))
              .map((leaf) => leaf.fullKey),
          );

          const written = Object.fromEntries(
            wanted.flatMap((leaf) => {
              const result = fetched.get(leaf.fullKey);

              return result !== undefined && Result.isSuccess(result) && cacheable.has(leaf.fullKey)
                ? [
                    [
                      leaf.fullKey,
                      {
                        provider: leaf.provider.id,
                        reference: leaf.description,
                        value: Redacted.make(result.success),
                        resolvedAt: now,
                      },
                    ],
                  ]
                : [];
            }),
          );

          yield* cache
            .setMany(written)
            .pipe(Timing.measure("cache.write", { references: Object.keys(written).length }));
        }),
      )
      .pipe(Timing.measure("resolve.lock"));
  }

  // 5. Evaluate each descriptor once. The memo holds lazy effects, so the order is free.
  const memo = new Map<Source.AnySource, Effect.Effect<Evaluated, VarError | CacheError>>();

  const orStale = (
    source: Source.AnySource,
    error: VarError | CacheError,
  ): Effect.Effect<Evaluated, VarError | CacheError> =>
    isTransient(error)
      ? Option.match(staleRecord(source), {
          onNone: () => Effect.fail(error),
          onSome: (found) =>
            Effect.as(
              Effect.logWarning("Envi uses an expired cache entry after a transient failure.").pipe(
                Effect.annotateLogs({ provider: found.provider, reference: found.reference }),
              ),
              fromRecord(found, ValueOrigin.StaleCache),
            ),
        })
      : Effect.fail(error);

  const evaluated = (source: Source.AnySource): Effect.Effect<Evaluated, VarError | CacheError> =>
    memo.get(source) ?? Effect.die("Envi resolver defect: a descriptor has no memo entry.");

  const evaluate = (source: Source.AnySource): Effect.Effect<Evaluated, VarError | CacheError> =>
    Source.Origin.$match(source.origin, {
      Literal: (origin) =>
        Effect.succeed({
          raw: Option.some(Redacted.make(origin.value)),
          origin: ValueOrigin.Literal,
          provider: Option.none(),
          reference: Option.none(),
          resolvedAt: Option.none(),
        }),
      Environment: (origin) =>
        Config.option(Config.Redacted(origin.name)).pipe(
          Effect.mapError(
            () =>
              new ProviderError({
                reason: ProviderFailure.Misconfigured,
                provider: environmentProviderId,
                detail: `The environment variable ${origin.name} is not readable.`,
              }),
          ),
          Effect.flatMap(
            Option.match({
              onNone: () => whenMissing(source, environmentProviderId, `env:${origin.name}`),
              onSome: (raw) =>
                Effect.succeed({
                  raw: Option.some(raw),
                  origin: ValueOrigin.Environment,
                  provider: Option.some(environmentProviderId),
                  reference: Option.some(`env:${origin.name}`),
                  resolvedAt: Option.none(),
                }),
            }),
          ),
        ),
      Reference: () => {
        const leaf = leaves.get(source);

        if (leaf === undefined) {
          return Effect.die("Envi resolver defect: a reference has no prepared leaf.");
        }

        if (Result.isFailure(leaf)) {
          return Effect.fail(leaf.failure);
        }

        const { description, fullKey, provider } = leaf.success;
        const result = fetched.get(fullKey);

        if (result === undefined) {
          return Option.match(freshRecord(source, afterLock), {
            onNone: () =>
              Effect.die("Envi resolver defect: a reference is neither fresh nor fetched."),
            onSome: (found) => Effect.succeed(fromRecord(found, ValueOrigin.Cache)),
          });
        }

        return Result.match(result, {
          onSuccess: (raw) =>
            Effect.succeed({
              raw: Option.some(Redacted.make(raw)),
              origin: ValueOrigin.Provider,
              provider: Option.some(provider.id),
              reference: Option.some(description),
              resolvedAt: Option.some(now),
            }),
          onFailure: (error) =>
            Predicate.isTagged(error, "ReferenceError") &&
            error.reason === ReferenceFailure.NotFound
              ? whenMissing(source, provider.id, description)
              : orStale(source, error),
        });
      },
      Custom: (origin) => {
        const description = Option.match(origin.key, {
          onNone: () => "custom()",
          onSome: (key) => `custom(${key})`,
        });

        return Option.match(freshRecord(source, cached), {
          onSome: (found) => Effect.succeed(fromRecord(found, ValueOrigin.Cache)),
          onNone: () =>
            Effect.gen(function* () {
              // A value from an expired input is itself expired. Envi never caches it as fresh,
              // and the origin tells `inspect` and an outer custom() about it.
              const usedStale = yield* Ref.make(false);

              const raw = yield* origin
                .run((input) =>
                  Effect.flatMap(
                    Effect.tap(evaluated(input), (result) =>
                      result.origin === ValueOrigin.StaleCache
                        ? Ref.set(usedStale, true)
                        : Effect.void,
                    ),
                    (result) => decodeEvaluated(input, "an input of custom()", result),
                  ),
                )
                .pipe(Timing.measure("custom.resolve", { reference: description }));

              const isStale = yield* Ref.get(usedStale);

              if (!isStale && !isCacheDisabled(source.cachePolicy) && Option.isSome(origin.key)) {
                yield* cache.setMany({
                  [customKeyOf(origin.key.value)]: {
                    provider: Source.customProviderId,
                    reference: description,
                    value: Redacted.make(raw),
                    resolvedAt: now,
                  },
                });
              }

              return {
                raw: Option.some(Redacted.make(raw)),
                origin: isStale ? ValueOrigin.StaleCache : ValueOrigin.Custom,
                provider: Option.some(Source.customProviderId),
                reference: Option.some(description),
                resolvedAt: Option.some(now),
              };
            }).pipe(Effect.catch((error) => orStale(source, error))),
        });
      },
    });

  for (const source of all) {
    memo.set(source, yield* Effect.cached(evaluate(source)));
  }

  const entries = yield* Effect.forEach(
    Object.entries(sources),
    ([key, source]) =>
      evaluated(source).pipe(
        Effect.flatMap((result) =>
          Effect.map(decodeEvaluated(source, key, result), (decoded) => ({
            ...result,
            decoded,
            isRedacted: source.isRedacted,
          })),
        ),
        Effect.map((resolved) => [key, Result.succeed(resolved)] as const),
        Effect.catchTags({
          DecodeError: (error) => Effect.succeed([key, Result.fail(error)] as const),
          ProviderError: (error) => Effect.succeed([key, Result.fail(error)] as const),
          ReferenceError: (error) => Effect.succeed([key, Result.fail(error)] as const),
        }),
      ),
    { concurrency: "unbounded" },
  );

  const reachableLeaves = [...reachable].flatMap((source) =>
    Option.toArray(Option.map(leafOf(source), (leaf) => ({ leaf, source }))),
  );

  const counts = Object.entries(Arr.groupBy(reachableLeaves, ({ leaf }) => leaf.provider.id)).map(
    ([provider, group]) => {
      const keys = new Map(group.map(({ leaf, source }) => [leaf.fullKey, source] as const));

      const resolved = [...keys.keys()].filter((key) => {
        const result = fetched.get(key);

        return result !== undefined && Result.isSuccess(result);
      }).length;

      return {
        provider,
        secrets: keys.size,
        cached: [...keys].filter(
          ([key, source]) => !fetched.has(key) && Option.isSome(freshRecord(source, afterLock)),
        ).length,
        resolved,
      };
    },
  );

  const resolution: Resolution = { vars: Object.fromEntries(entries), providers: counts };

  return resolution;
});

const decodeEvaluated = <A, Optional extends boolean>(
  source: Source.Source<A, Optional>,
  key: string,
  result: Evaluated,
): Effect.Effect<Source.Decoded<Source.Source<A, Optional>>, DecodeError> =>
  Option.match(result.raw, {
    // SAFETY: TypeScript cannot narrow the conditional type. `raw` is absent only for an
    // optional descriptor, and `Decoded` of an optional descriptor includes `undefined`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    onNone: () => Effect.succeed(undefined as Source.Decoded<Source.Source<A, Optional>>),
    onSome: (raw) =>
      // SAFETY: For a descriptor with a value, `Decoded` is `A` or `A | undefined`. Both accept `A`.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      Source.decode(source, key, Redacted.value(raw)) as Effect.Effect<
        Source.Decoded<Source.Source<A, Optional>>,
        DecodeError
      >,
  });
