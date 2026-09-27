// The cache rules of a resolution: when an entry is fresh, when an expired entry may serve a
// transient failure, and when a missing value is an answer.
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import type * as Cache from "./Cache.ts";
import { ReferenceFailure, type VarError } from "./Errors.ts";
import * as ResolverPlan from "./ResolverPlan.ts";
import type * as Source from "./Source.ts";

/** The settings of a resolution that the rules need. */
export interface Settings {
  /** Ignores fresh cache entries. A stale entry still serves the fallback. */
  readonly refresh: boolean;
  /** Disables the stale fallback. */
  readonly strict: boolean;
}

/** The cache rules of one resolution, bound to its plan, its settings, and its start time. */
export interface Freshness {
  /** The entry of a descriptor in a set of records. */
  readonly recordIn: (
    source: Source.AnySource,
    records: Cache.CacheRecords,
  ) => Option.Option<Cache.CacheRecord>;
  /** The entry of a descriptor when it is fresh and serves the descriptor. */
  readonly freshRecord: (
    source: Source.AnySource,
    records: Cache.CacheRecords,
  ) => Option.Option<Cache.CacheRecord>;
  readonly isFresh: (source: Source.AnySource, found: Cache.CacheRecord) => boolean;
  /** `true` when an expired entry may serve a transient failure. */
  readonly isUsableStale: (source: Source.AnySource, found: Cache.CacheRecord) => boolean;
}

/** A var with `.optional()` or `.default()` accepts a reference without a value. */
export const allowsMissing = (source: Source.AnySource): boolean =>
  source.isOptional || Option.isSome(source.fallback);

export const isNotFound = (error: VarError): boolean =>
  Predicate.isTagged(error, "SecretReferenceError") && error.reason === ReferenceFailure.NotFound;

/** An entry serves a descriptor when it holds a value, or when the descriptor accepts none. */
const serves = (source: Source.AnySource, found: Cache.CacheRecord): boolean =>
  Option.isSome(found.value) || allowsMissing(source);

export const make = (plan: ResolverPlan.Plan, settings: Settings, now: number): Freshness => {
  const ageBelow = (found: Cache.CacheRecord, limit: Duration.Duration): boolean =>
    now - found.resolvedAt < Duration.toMillis(limit);

  const recordIn: Freshness["recordIn"] = (source, records) =>
    Option.flatMap(ResolverPlan.cacheKeyOf(plan, source), (key) =>
      Option.fromUndefinedOr(records[key]),
    );

  const isFresh: Freshness["isFresh"] = (source, found) =>
    !settings.refresh &&
    ageBelow(found, ResolverPlan.durationsOf(plan, source).ttl) &&
    serves(source, found);

  const isUsableStale: Freshness["isUsableStale"] = (source, found) =>
    !settings.strict &&
    ageBelow(found, ResolverPlan.durationsOf(plan, source).maxStale) &&
    serves(source, found);

  return {
    recordIn,
    freshRecord: (source, records) =>
      Option.filter(recordIn(source, records), (found) => isFresh(source, found)),
    isFresh,
    isUsableStale,
  };
};
