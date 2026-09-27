// One resolution of a record of descriptors. Each step lives in its own module: `ResolverPlan`,
// `Freshness`, `ResolverFetch`, and `ResolverEvaluate`. This module runs them in order.
import * as Clock from "effect/Clock";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Result from "effect/Result";

import * as Cache from "./Cache.ts";
import type * as Errors from "./Errors.ts";
import * as Freshness from "./Freshness.ts";
import * as ResolverEvaluate from "./ResolverEvaluate.ts";
import * as ResolverFetch from "./ResolverFetch.ts";
import * as ResolverPlan from "./ResolverPlan.ts";
import type * as Source from "./Source.ts";
import * as Timing from "./Timing.ts";

/** The settings of one resolution. The caller applies the precedence order before it calls. */
export interface Options {
  /** The stage. A `custom()` value keeps one cache entry for each stage. */
  readonly stage: string;
  /** Ignores fresh cache entries. A stale entry still serves the fallback. */
  readonly refresh: boolean;
  /** Disables the stale fallback. CI is always strict. */
  readonly strict: boolean;
  readonly interactive: boolean;
  readonly ttl: Duration.Duration;
  readonly maxStale: Duration.Duration;
}

/** The failure of one var. A cache failure is not one: it fails the whole resolution. */
export type VarError = Errors.VarError;

/** One resolved var. `raw` is absent for an optional var without a value. */
export type Resolved = ResolverEvaluate.Resolved;

/** The provider counts of one resolution. `sync` reports them. */
export type ProviderCounts = ResolverFetch.ProviderCounts;

/** The result of one resolution: one outcome for each var, plus the provider counts. */
export interface Resolution {
  readonly vars: Readonly<Record<string, Result.Result<Resolved, VarError>>>;
  readonly providers: ReadonlyArray<ProviderCounts>;
}

/**
 * Resolves a record of descriptors in five ordered steps: plan the descriptors, read the cache,
 * select the misses, fetch them under the lock with one call for each provider, and evaluate each
 * descriptor from the inside to the outside.
 *
 * @returns One outcome for each var. Only a cache failure or an invalid setting fails the whole
 * effect.
 */
export const resolve = Effect.fn("Resolver.resolve")(function* (
  sources: Readonly<Record<string, Source.AnySource>>,
  options: Options,
) {
  const cache = yield* Cache.Cache;
  const now = yield* Clock.currentTimeMillis;

  // 1. Walk every descriptor, including every input, and prepare the references.
  const plan = yield* ResolverPlan.make(sources, options);
  const freshness = Freshness.make(plan, options, now);

  // 2. One cache read for every key that can have an entry.
  const keys = ResolverPlan.cacheKeys(plan);

  const cached = yield* cache
    .getMany(keys)
    .pipe(Timing.measure(Timing.Step.CacheRead, { references: keys.length }));

  // 3 and 4. Select the misses, then call each provider once under the resolve lock.
  const fetched = yield* ResolverFetch.fetch(plan, freshness, cached, options, now);

  // 5. Evaluate each descriptor once.
  const vars = yield* ResolverEvaluate.evaluate(sources, { plan, freshness, cached, fetched, now });

  const resolution: Resolution = {
    vars,
    providers: ResolverFetch.countsOf(plan, freshness, fetched),
  };

  return resolution;
});
