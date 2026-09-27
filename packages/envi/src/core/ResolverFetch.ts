// Steps 3 and 4 of a resolution: select the references without a fresh entry, then call each
// provider once under the resolve lock, after a second cache read, and write the answers.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";

import * as Cache from "./Cache.ts";
import { ProviderError, ProviderFailure, SecretReferenceError, type VarError } from "./Errors.ts";
import * as Freshness from "./Freshness.ts";
import type * as Provider from "./Provider.ts";
import * as ResolverPlan from "./ResolverPlan.ts";
import * as Source from "./Source.ts";
import * as Timing from "./Timing.ts";

/** The answer of a provider for each cache key that the resolution asked for. */
export type Answers = ReadonlyMap<string, Result.Result<string, VarError>>;

/** The result of the fetch step. */
export interface Fetched {
  readonly answers: Answers;
  /** The cache records after the second read under the lock. */
  readonly records: Cache.CacheRecords;
}

/** The settings of a resolution that the fetch step needs. */
export interface Settings {
  readonly refresh: boolean;
  readonly interactive: boolean;
}

/** The provider counts of one resolution. `sync` reports them. */
export interface ProviderCounts {
  readonly provider: string;
  readonly secrets: number;
  readonly cached: number;
  readonly resolved: number;
}

const isCacheDisabled = Source.CachePolicy.$is("Disabled");

const invalidResponse = (provider: string, detail: string): ProviderError =>
  new ProviderError({ reason: ProviderFailure.InvalidResponse, provider, detail });

/** The leaves of the references without a fresh entry, each cache key once. */
const misses = (
  plan: ResolverPlan.Plan,
  freshness: Freshness.Freshness,
  records: Cache.CacheRecords,
): ReadonlyArray<ResolverPlan.Leaf> => [
  ...new Map(
    ResolverPlan.references(plan)
      .filter((source) => Option.isNone(freshness.freshRecord(source, records)))
      .flatMap((source) => Option.toArray(ResolverPlan.leafOf(plan, source)))
      .map((leaf) => [leaf.fullKey, leaf] as const),
  ).values(),
];

/** The cache keys of the references whose descriptor passes `predicate`. */
const keysWhere = (
  plan: ResolverPlan.Plan,
  predicate: (source: Source.AnySource) => boolean,
): ReadonlySet<string> =>
  new Set(
    ResolverPlan.references(plan)
      .filter(predicate)
      .flatMap((source) => Option.toArray(ResolverPlan.leafOf(plan, source)))
      .map((leaf) => leaf.fullKey),
  );

/** One call to one provider. Each leaf gets the answer of its key, or the failure of the call. */
const callProvider = (
  provider: Provider.Provider,
  wanted: ReadonlyArray<ResolverPlan.Leaf>,
  interactive: boolean,
): Effect.Effect<ReadonlyArray<readonly [string, Result.Result<string, VarError>]>> =>
  Effect.logDebug("Envi calls a provider with one batch.").pipe(
    Effect.annotateLogs({
      provider: provider.id,
      references: wanted.map((leaf) => leaf.description).join(", "),
    }),
    Effect.andThen(
      provider.resolveMany(
        wanted.map((leaf) => ({ key: leaf.fullKey, reference: leaf.reference })),
        { interactive },
      ),
    ),
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
    Timing.measure(Timing.Step.ProviderResolve, {
      provider: provider.id,
      references: wanted.length,
    }),
    Effect.result,
    Effect.map((outcome) =>
      wanted.map((leaf) => {
        const answer = Result.match(outcome, {
          onFailure: (error): Result.Result<string, VarError> => Result.fail(error),
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
                new SecretReferenceError({
                  reason,
                  provider: provider.id,
                  reference: leaf.description,
                }),
            );
          },
        });

        return [leaf.fullKey, answer] as const;
      }),
    ),
  );

/** The cache records of the answers. A value and an accepted `NotFound` enter the cache. */
const recordsOf = (
  plan: ResolverPlan.Plan,
  wanted: ReadonlyArray<ResolverPlan.Leaf>,
  answers: Answers,
  now: number,
): Cache.CacheRecords => {
  const cacheable = keysWhere(plan, (source) => !isCacheDisabled(source.cachePolicy));

  // A `NotFound` serves only a var that accepts it, so only such a var caches it.
  const acceptsMissing = keysWhere(plan, Freshness.allowsMissing);

  return Object.fromEntries(
    wanted.flatMap((leaf) => {
      const result = answers.get(leaf.fullKey);

      if (result === undefined || !cacheable.has(leaf.fullKey)) {
        return [];
      }

      const value = Result.isSuccess(result)
        ? Option.some(Option.some(Redacted.make(result.success)))
        : Option.some(Option.none<Redacted.Redacted>()).pipe(
            Option.filter(
              () => Freshness.isNotFound(result.failure) && acceptsMissing.has(leaf.fullKey),
            ),
          );

      return Option.toArray(
        Option.map(value, (found) => [
          leaf.fullKey,
          {
            provider: leaf.provider.id,
            reference: leaf.description,
            value: found,
            resolvedAt: now,
          },
        ]),
      );
    }),
  );
};

/** Calls each provider once for the references without a fresh entry, and caches the answers. */
export const fetch = Effect.fn("ResolverFetch.fetch")(function* (
  plan: ResolverPlan.Plan,
  freshness: Freshness.Freshness,
  cached: Cache.CacheRecords,
  settings: Settings,
  now: number,
) {
  const cache = yield* Cache.Cache;
  const keys = ResolverPlan.cacheKeys(plan);

  yield* Effect.logDebug("Envi read the cache.").pipe(
    Effect.annotateLogs({
      references: keys.length,
      misses: misses(plan, freshness, cached).length,
    }),
  );

  if (misses(plan, freshness, cached).length === 0) {
    const fetched: Fetched = { answers: new Map(), records: cached };

    return fetched;
  }

  // The time of this step includes the wait for the lock.
  return yield* cache
    .withResolveLock(
      Effect.gen(function* () {
        const records = settings.refresh ? cached : { ...cached, ...(yield* cache.getMany(keys)) };
        const wanted = misses(plan, freshness, records);
        const byProvider = Arr.groupBy(wanted, (leaf) => leaf.provider.id);

        const batches = yield* Effect.forEach(
          Object.values(byProvider),
          (leaves) => callProvider(leaves[0].provider, leaves, settings.interactive),
          { concurrency: "unbounded" },
        );

        const answers: Answers = new Map(batches.flat());
        const written = recordsOf(plan, wanted, answers, now);

        yield* cache
          .setMany(written)
          .pipe(
            Timing.measure(Timing.Step.CacheWrite, { references: Object.keys(written).length }),
          );

        const fetched: Fetched = { answers, records };

        return fetched;
      }),
    )
    .pipe(Timing.measure(Timing.Step.ResolveLock));
});

/** The provider counts: the secrets, the fresh cache hits, and the answers of each provider. */
export const countsOf = (
  plan: ResolverPlan.Plan,
  freshness: Freshness.Freshness,
  fetched: Fetched,
): ReadonlyArray<ProviderCounts> => {
  const leaves = ResolverPlan.references(plan).flatMap((source) =>
    Option.toArray(Option.map(ResolverPlan.leafOf(plan, source), (leaf) => ({ leaf, source }))),
  );

  return Object.entries(Arr.groupBy(leaves, ({ leaf }) => leaf.provider.id)).map(
    ([provider, group]) => {
      const keys = new Map(group.map(({ leaf, source }) => [leaf.fullKey, source] as const));

      // A `NotFound` counts as resolved: the provider answered, and the cache holds the answer.
      const resolved = [...keys.keys()].filter((key) => {
        const result = fetched.answers.get(key);

        return (
          result !== undefined && (Result.isSuccess(result) || Freshness.isNotFound(result.failure))
        );
      }).length;

      return {
        provider,
        secrets: keys.size,
        cached: [...keys].filter(
          ([key, source]) =>
            !fetched.answers.has(key) &&
            Option.isSome(freshness.freshRecord(source, fetched.records)),
        ).length,
        resolved,
      };
    },
  );
};
