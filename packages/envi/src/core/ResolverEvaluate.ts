// Step 5 of a resolution: evaluate each descriptor once, from the inside to the outside. A value
// comes from a literal, the environment, the cache, a provider answer, or user code.
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as Cache from "./Cache.ts";
import * as Digest from "./Digest.ts";
import {
  type CacheError,
  type DecodeError,
  ProviderError,
  ProviderFailure,
  ReferenceFailure,
  SecretReferenceError,
  type VarError,
} from "./Errors.ts";
import * as Freshness from "./Freshness.ts";
import { ValueOrigin } from "./Reports.ts";
import type * as ResolverFetch from "./ResolverFetch.ts";
import type * as ResolverPlan from "./ResolverPlan.ts";
import * as Source from "./Source.ts";
import * as Timing from "./Timing.ts";

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

/** The state that the earlier steps hand to the evaluate step. */
export interface Input {
  readonly plan: ResolverPlan.Plan;
  readonly freshness: Freshness.Freshness;
  /** The records of the first cache read. A transient failure falls back to them. */
  readonly cached: Cache.CacheRecords;
  readonly fetched: ResolverFetch.Fetched;
  readonly now: number;
}

/** A value before its decode. */
interface Evaluated {
  readonly raw: Option.Option<Redacted.Redacted>;
  readonly origin: ValueOrigin;
  readonly provider: Option.Option<string>;
  readonly reference: Option.Option<string>;
  readonly resolvedAt: Option.Option<number>;
}

/** The evaluated inputs of a `derive()` or `custom()` value. */
interface Inputs {
  readonly decoded: Source.DecodedInputs;
  /** The raw values, sorted by input name. Only a digest of them leaves the resolver. */
  readonly raws: ReadonlyArray<readonly [string, string | null]>;
  /** `true` when an input comes from an expired cache entry. */
  readonly isStale: boolean;
}

type Evaluation = Effect.Effect<Evaluated, VarError | CacheError>;

/** The id under which `fromEnv` values appear in reports and errors. */
const environmentProviderId = "environment";

const isCacheDisabled = Source.CachePolicy.$is("Disabled");

/**
 * The cache value of a `custom()` value: the result plus a digest of what produced it. The digest
 * stays inside the encrypted value, because it comes from the input values.
 */
const CustomRecord = Schema.fromJsonString(
  Schema.Struct({ digest: Schema.String, value: Schema.NullOr(Schema.String) }),
);

const decodeCustomRecord = Schema.decodeUnknownOption(CustomRecord);

const encodeCustomRecord = Schema.encodeSync(CustomRecord);

/** Only a provider outage and a `CustomFailure` that says so allow the stale fallback. */
const isTransient = (error: VarError | CacheError): boolean =>
  (Predicate.isTagged(error, "ProviderError") && error.reason === ProviderFailure.Unavailable) ||
  (Predicate.isTagged(error, "CustomError") && error.transient);

/** A value that no provider and no cache stands behind. */
const unsourced = (raw: Option.Option<Redacted.Redacted>, origin: ValueOrigin): Evaluated => ({
  raw,
  origin,
  provider: Option.none(),
  reference: Option.none(),
  resolvedAt: Option.none(),
});

const fromRecord = (found: Cache.CacheRecord, origin: ValueOrigin): Evaluated => ({
  raw: found.value,
  origin,
  provider: Option.some(found.provider),
  reference: Option.some(found.reference),
  resolvedAt: Option.some(found.resolvedAt),
});

/** A missing value becomes the default, `undefined` for an optional var, or `NotFound`. */
const whenMissing = (source: Source.AnySource, provider: string, reference: string): Evaluation => {
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
    : Effect.fail(
        new SecretReferenceError({ reason: ReferenceFailure.NotFound, provider, reference }),
      );
};

/** A value from an expired input is itself expired, and the origin tells `inspect` so. */
const withInputs = (result: Evaluated, inputs: Inputs): Evaluated =>
  inputs.isStale && result.origin !== ValueOrigin.StaleCache
    ? { ...result, origin: ValueOrigin.StaleCache }
    : result;

/** A cached `NotFound` serves only a var that accepts a missing value. */
const fromCached = (
  source: Source.AnySource,
  found: Cache.CacheRecord,
  origin: ValueOrigin,
): Evaluation =>
  Option.isSome(found.value)
    ? Effect.succeed(fromRecord(found, origin))
    : whenMissing(source, found.provider, found.reference);

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

const fromEnvironment = (source: Source.AnySource, name: string): Evaluation =>
  Config.option(Config.Redacted(name)).pipe(
    Effect.mapError(
      () =>
        new ProviderError({
          reason: ProviderFailure.Misconfigured,
          provider: environmentProviderId,
          detail: `The environment variable ${name} is not readable.`,
        }),
    ),
    Effect.flatMap(
      Option.match({
        onNone: () => whenMissing(source, environmentProviderId, `env:${name}`),
        onSome: (raw) =>
          Effect.succeed({
            raw: Option.some(raw),
            origin: ValueOrigin.Environment,
            provider: Option.some(environmentProviderId),
            reference: Option.some(`env:${name}`),
            resolvedAt: Option.none(),
          }),
      }),
    ),
  );

/** What the evaluation of one descriptor reads: the earlier steps, the cache, and the memo. */
interface Step extends Input {
  readonly cache: Cache.Interface;
  /** The evaluation of another descriptor. Each descriptor runs once. */
  readonly evaluated: (source: Source.AnySource) => Evaluation;
}

/** Uses an expired cache entry after a transient failure, while `maxStale` allows it. */
const orStale = (
  step: Step,
  source: Source.AnySource,
  record: Option.Option<Cache.CacheRecord>,
  error: VarError | CacheError,
): Evaluation =>
  isTransient(error)
    ? Option.match(
        Option.filter(record, (found) => step.freshness.isUsableStale(source, found)),
        {
          onNone: () => Effect.fail(error),
          onSome: (found) =>
            Effect.andThen(
              Effect.logWarning("Envi uses an expired cache entry after a transient failure.").pipe(
                Effect.annotateLogs({ provider: found.provider, reference: found.reference }),
              ),
              fromCached(source, found, ValueOrigin.StaleCache),
            ),
        },
      )
    : Effect.fail(error);

/** Evaluates and decodes the inputs of a `derive()` or `custom()` value. */
const evaluateInputs = (
  step: Step,
  inputs: Readonly<Record<string, Source.AnySource>>,
  owner: string,
): Effect.Effect<Inputs, VarError | CacheError> =>
  Effect.map(
    Effect.forEach(Object.entries(inputs), ([name, inputSource]) =>
      Effect.flatMap(step.evaluated(inputSource), (result) =>
        Effect.map(decodeEvaluated(inputSource, `an input of ${owner}`, result), (decoded) => ({
          name,
          result,
          decoded,
        })),
      ),
    ),
    (entries) => ({
      decoded: Object.fromEntries(entries.map((entry) => [entry.name, entry.decoded])),
      raws: entries
        .map(
          (entry) =>
            [entry.name, Option.getOrNull(Option.map(entry.result.raw, Redacted.value))] as const,
        )
        .toSorted(([a], [b]) => (a < b ? -1 : 1)),
      isStale: entries.some((entry) => entry.result.origin === ValueOrigin.StaleCache),
    }),
  );

const fromReference = (step: Step, source: Source.AnySource): Evaluation => {
  const leaf = step.plan.leaves.get(source);

  if (leaf === undefined) {
    return Effect.die("Envi resolver defect: a reference has no prepared leaf.");
  }

  if (Result.isFailure(leaf)) {
    return Effect.fail(leaf.failure);
  }

  const { description, fullKey, provider } = leaf.success;
  const answer = step.fetched.answers.get(fullKey);

  if (answer === undefined) {
    return Option.match(step.freshness.freshRecord(source, step.fetched.records), {
      onNone: () => Effect.die("Envi resolver defect: a reference is neither fresh nor fetched."),
      onSome: (found) => fromCached(source, found, ValueOrigin.Cache),
    });
  }

  return Result.match(answer, {
    onSuccess: (raw) =>
      Effect.succeed({
        raw: Option.some(Redacted.make(raw)),
        origin: ValueOrigin.Provider,
        provider: Option.some(provider.id),
        reference: Option.some(description),
        resolvedAt: Option.some(step.now),
      }),
    onFailure: (error) =>
      Freshness.isNotFound(error)
        ? whenMissing(source, provider.id, description)
        : orStale(step, source, step.freshness.recordIn(source, step.cached), error),
  });
};

const fromDerive = (
  step: Step,
  source: Source.AnySource,
  origin: Source.Origin & { _tag: "Derived" },
): Evaluation =>
  Effect.gen(function* () {
    const inputs = yield* evaluateInputs(step, origin.inputs, "derive()");
    const value = yield* origin.call(inputs.decoded);

    if (Option.isNone(value)) {
      return yield* whenMissing(source, Source.deriveProviderId, "derive()");
    }

    return withInputs(
      unsourced(Option.some(Redacted.make(value.value)), ValueOrigin.Derived),
      inputs,
    );
  });

/**
 * The cached result of a `custom()` value. An entry that other inputs or other code produced
 * does not exist for this run.
 */
const customRecord = (
  entry: Option.Option<Cache.CacheRecord>,
  digest: string,
): Option.Option<Cache.CacheRecord> =>
  Option.flatMap(entry, (found) =>
    found.value.pipe(
      Option.flatMap((value) => decodeCustomRecord(Redacted.value(value))),
      Option.filter((decoded) => decoded.digest === digest),
      Option.map((decoded): Cache.CacheRecord => ({
        ...found,
        value: Option.map(Option.fromNullOr(decoded.value), Redacted.make),
      })),
    ),
  );

const fromCustom = (
  step: Step,
  source: Source.AnySource,
  origin: Source.Origin & { _tag: "Custom" },
): Evaluation => {
  const description = `custom(${origin.id})`;
  const key = step.plan.customKeys.get(source);

  if (key === undefined) {
    return Effect.die("Envi resolver defect: a custom() value has no cache key.");
  }

  return Effect.gen(function* () {
    const inputs = yield* evaluateInputs(step, origin.inputs, description);
    const digest = yield* Digest.sha256Hex(JSON.stringify([origin.code, inputs.raws]));
    const record = customRecord(Option.fromUndefinedOr(step.fetched.records[key]), digest);
    const fresh = Option.filter(record, (found) => step.freshness.isFresh(source, found));

    if (Option.isSome(fresh)) {
      return withInputs(yield* fromCached(source, fresh.value, ValueOrigin.Cache), inputs);
    }

    const outcome = yield* Effect.result(
      origin
        .call(inputs.decoded)
        .pipe(Timing.measure(Timing.Step.CustomResolve, { reference: description })),
    );

    if (Result.isFailure(outcome)) {
      return yield* orStale(step, source, record, outcome.failure);
    }

    const value = outcome.success;

    // A value from an expired input is safe to cache: the digest holds the old input values.
    if (
      !isCacheDisabled(source.cachePolicy) &&
      (Option.isSome(value) || Freshness.allowsMissing(source))
    ) {
      const stored = encodeCustomRecord({ digest, value: Option.getOrNull(value) });

      yield* step.cache.setMany({
        [key]: {
          provider: Source.customProviderId,
          reference: description,
          value: Option.some(Redacted.make(stored)),
          resolvedAt: step.now,
        },
      });
    }

    if (Option.isNone(value)) {
      return yield* whenMissing(source, Source.customProviderId, description);
    }

    return withInputs(
      {
        raw: Option.some(Redacted.make(value.value)),
        origin: ValueOrigin.Custom,
        provider: Option.some(Source.customProviderId),
        reference: Option.some(description),
        resolvedAt: Option.some(step.now),
      },
      inputs,
    );
  });
};

const evaluateOne = (step: Step, source: Source.AnySource): Evaluation =>
  Source.Origin.$match(source.origin, {
    Literal: (origin) =>
      Effect.succeed(unsourced(Option.some(Redacted.make(origin.value)), ValueOrigin.Literal)),
    Environment: (origin) => fromEnvironment(source, origin.name),
    Reference: () => fromReference(step, source),
    Derived: (origin) => fromDerive(step, source, origin),
    Custom: (origin) => fromCustom(step, source, origin),
  });

/** Evaluates and decodes one var. The failure of the var stays in its result. */
const resolveVar = (step: Step, key: string, source: Source.AnySource) =>
  step.evaluated(source).pipe(
    Effect.flatMap((result) =>
      Effect.map(decodeEvaluated(source, key, result), (decoded) => ({
        ...result,
        decoded,
        isRedacted: source.isRedacted,
      })),
    ),
    Effect.map((resolved: Resolved) => [key, Result.succeed(resolved)] as const),
    Effect.catchTags({
      CustomError: (error) => Effect.succeed([key, Result.fail(error)] as const),
      DecodeError: (error) => Effect.succeed([key, Result.fail(error)] as const),
      DeriveError: (error) => Effect.succeed([key, Result.fail(error)] as const),
      ProviderError: (error) => Effect.succeed([key, Result.fail(error)] as const),
      SecretReferenceError: (error) => Effect.succeed([key, Result.fail(error)] as const),
    }),
  );

/** Evaluates every var of a resolution. Only a cache failure fails the whole effect. */
export const evaluate = Effect.fn("ResolverEvaluate.evaluate")(function* (
  sources: Readonly<Record<string, Source.AnySource>>,
  input: Input,
) {
  // The memo holds lazy effects, so the order of evaluation is free.
  const memo = new Map<Source.AnySource, Evaluation>();

  const step: Step = {
    ...input,
    cache: yield* Cache.Cache,
    evaluated: (source) =>
      memo.get(source) ?? Effect.die("Envi resolver defect: a descriptor has no memo entry."),
  };

  for (const source of input.plan.all) {
    memo.set(source, yield* Effect.cached(evaluateOne(step, source)));
  }

  const entries = yield* Effect.forEach(
    Object.entries(sources),
    ([key, source]) => resolveVar(step, key, source),
    { concurrency: "unbounded" },
  );

  return Object.fromEntries(entries);
});
