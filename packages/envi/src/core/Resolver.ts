import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as Cache from "./Cache.ts";
import * as Digest from "./Digest.ts";
import type * as Errors from "./Errors.ts";
import {
  type CacheError,
  type DecodeError,
  ProviderError,
  ProviderFailure,
  SecretReferenceError,
  ReferenceFailure,
} from "./Errors.ts";
import * as Provider from "./Provider.ts";
import { ValueOrigin } from "./Reports.ts";
import * as Source from "./Source.ts";
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
  readonly ttl: Duration.Input;
  readonly maxStale: Duration.Input;
}

/** The failure of one var. A cache failure is not one: it fails the whole resolution. */
export type VarError = Errors.VarError;

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

/** The evaluated inputs of a `derive()` or `custom()` value. */
interface Inputs {
  readonly decoded: Source.DecodedInputs;
  /** The raw values, sorted by input name. Only a digest of them leaves the resolver. */
  readonly raws: ReadonlyArray<readonly [string, string | null]>;
  /** `true` when an input comes from an expired cache entry. */
  readonly isStale: boolean;
}

const isCustom = Source.Origin.$is("Custom");

const isDerived = Source.Origin.$is("Derived");

const isReference = Source.Origin.$is("Reference");

const isCacheDisabled = Source.CachePolicy.$is("Disabled");

/** The hex digits of the scope hash in a cache key. 64 bits keep two scopes apart. */
const scopeHashLength = 16;

/** The hex digits of the stage and scope hash in the cache key of a `custom()` value. */
const customHashLength = 16;

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

/** The inputs of a `derive()` or `custom()` value. */
const inputsOf = (source: Source.AnySource): ReadonlyArray<Source.AnySource> =>
  isCustom(source.origin) || isDerived(source.origin) ? Object.values(source.origin.inputs) : [];

const invalidResponse = (provider: string, detail: string): ProviderError =>
  new ProviderError({ reason: ProviderFailure.InvalidResponse, provider, detail });

const fromRecord = (found: Cache.CacheRecord, origin: ValueOrigin): Evaluated => ({
  raw: found.value,
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
    : Effect.fail(
        new SecretReferenceError({ reason: ReferenceFailure.NotFound, provider, reference }),
      );
};

/** A value from an expired input is itself expired, and the origin tells `inspect` so. */
const withInputs = (result: Evaluated, inputs: Inputs): Evaluated =>
  inputs.isStale && result.origin !== ValueOrigin.StaleCache
    ? { ...result, origin: ValueOrigin.StaleCache }
    : result;

/** A var with `.optional()` or `.default()` accepts a reference without a value. */
const allowsMissing = (source: Source.AnySource): boolean =>
  source.isOptional || Option.isSome(source.fallback);

const isNotFound = (error: VarError): boolean =>
  Predicate.isTagged(error, "SecretReferenceError") && error.reason === ReferenceFailure.NotFound;

/** A cached `NotFound` serves only a var that accepts a missing value. */
const fromCached = (
  source: Source.AnySource,
  found: Cache.CacheRecord,
  origin: ValueOrigin,
): Effect.Effect<Evaluated, VarError> =>
  Option.isSome(found.value)
    ? Effect.succeed(fromRecord(found, origin))
    : whenMissing(source, found.provider, found.reference);

/**
 * Resolves a record of descriptors: one cache read, one call for each provider, then the
 * `derive()` and `custom()` values from the inside to the outside.
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

  // 1. Walk every descriptor, including every input, and prepare the references.
  const all = new Set<Source.AnySource>();
  const leaves = new Map<Source.AnySource, Result.Result<Leaf, VarError>>();

  const collect = (source: Source.AnySource): void => {
    if (all.has(source)) {
      return;
    }

    all.add(source);
    inputsOf(source).forEach(collect);
  };

  Object.values(sources).forEach(collect);

  // The scope can hold a credential. Only its hash enters a cache key.
  const scopeHashes = new Map(
    yield* Effect.forEach(providers.all, (provider) =>
      Effect.map(
        Effect.result(Effect.flatMap(provider.scope, Digest.sha256Hex)),
        (hash) => [provider.id, hash] as const,
      ),
    ),
  );

  for (const source of all) {
    if (isReference(source.origin)) {
      const { provider: providerId, reference } = source.origin;

      leaves.set(
        source,
        yield* Effect.result(
          Effect.gen(function* () {
            const provider = yield* providers.get(providerId);
            const prepared = yield* provider.prepare(reference);
            const scopeHash = scopeHashes.get(provider.id);

            if (scopeHash === undefined) {
              return yield* Effect.die("Envi resolver defect: a provider has no scope hash.");
            }

            const scope = (yield* Effect.fromResult(scopeHash)).slice(0, scopeHashLength);

            return {
              fullKey: `${provider.id}:${scope}:${prepared.referenceKey}`,
              provider,
              reference,
              description: prepared.description,
            };
          }),
        ),
      );
    }
  }

  // A custom() value keeps one entry for each stage and scope. Its record holds the input digest.
  const customKeys = new Map<Source.AnySource, string>();

  for (const source of all) {
    if (isCustom(source.origin)) {
      const hash = yield* Digest.sha256Hex(JSON.stringify([options.stage, source.origin.scope]));

      customKeys.set(
        source,
        `${Source.customProviderId}:${source.origin.id}:${hash.slice(0, customHashLength)}`,
      );
    }
  }

  const cacheKeyOf = (source: Source.AnySource): Option.Option<string> => {
    const customKey = customKeys.get(source);

    if (customKey !== undefined) {
      return Option.some(customKey);
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

  const recordIn = (
    source: Source.AnySource,
    records: Cache.CacheRecords,
  ): Option.Option<Cache.CacheRecord> =>
    Option.flatMap(cacheKeyOf(source), (key) => Option.fromUndefinedOr(records[key]));

  const isFresh = (source: Source.AnySource, found: Cache.CacheRecord): boolean =>
    !options.refresh &&
    now - found.resolvedAt < Duration.toMillis(durations(source).ttl) &&
    (Option.isSome(found.value) || allowsMissing(source));

  const isUsableStale = (source: Source.AnySource, found: Cache.CacheRecord): boolean =>
    !options.strict &&
    now - found.resolvedAt < Duration.toMillis(durations(source).maxStale) &&
    (Option.isSome(found.value) || allowsMissing(source));

  const freshRecord = (
    source: Source.AnySource,
    records: Cache.CacheRecords,
  ): Option.Option<Cache.CacheRecord> =>
    Option.filter(recordIn(source, records), (found) => isFresh(source, found));

  // 3. The references that can need a provider call. Envi evaluates every input of a custom()
  // value, because the inputs decide whether its entry still fits.
  const reachable = new Set([...all].filter((source) => isReference(source.origin)));

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
                      new SecretReferenceError({
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

          // A `NotFound` serves only a var that accepts it, so only such a var caches it.
          const acceptsMissing = new Set(
            [...reachable]
              .filter(allowsMissing)
              .flatMap((source) => Option.toArray(leafOf(source)))
              .map((leaf) => leaf.fullKey),
          );

          // A value and an accepted `NotFound` enter the cache. Any other failure never does.
          const written = Object.fromEntries(
            wanted.flatMap((leaf) => {
              const result = fetched.get(leaf.fullKey);

              if (result === undefined || !cacheable.has(leaf.fullKey)) {
                return [];
              }

              const value = Result.isSuccess(result)
                ? Option.some(Option.some(Redacted.make(result.success)))
                : Option.some(Option.none<Redacted.Redacted>()).pipe(
                    Option.filter(
                      () => isNotFound(result.failure) && acceptsMissing.has(leaf.fullKey),
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
    record: Option.Option<Cache.CacheRecord>,
    error: VarError | CacheError,
  ): Effect.Effect<Evaluated, VarError | CacheError> =>
    isTransient(error)
      ? Option.match(
          Option.filter(record, (found) => isUsableStale(source, found)),
          {
            onNone: () => Effect.fail(error),
            onSome: (found) =>
              Effect.andThen(
                Effect.logWarning(
                  "Envi uses an expired cache entry after a transient failure.",
                ).pipe(
                  Effect.annotateLogs({ provider: found.provider, reference: found.reference }),
                ),
                fromCached(source, found, ValueOrigin.StaleCache),
              ),
          },
        )
      : Effect.fail(error);

  /** Evaluates and decodes the inputs of a `derive()` or `custom()` value. */
  const evaluateInputs = (
    inputs: Readonly<Record<string, Source.AnySource>>,
    owner: string,
  ): Effect.Effect<Inputs, VarError | CacheError> =>
    Effect.map(
      Effect.forEach(Object.entries(inputs), ([name, input]) =>
        Effect.flatMap(evaluated(input), (result) =>
          Effect.map(decodeEvaluated(input, `an input of ${owner}`, result), (decoded) => ({
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
            onSome: (found) => fromCached(source, found, ValueOrigin.Cache),
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
            isNotFound(error)
              ? whenMissing(source, provider.id, description)
              : orStale(source, recordIn(source, cached), error),
        });
      },
      Derived: (origin) =>
        Effect.gen(function* () {
          const inputs = yield* evaluateInputs(origin.inputs, "derive()");
          const value = yield* origin.call(inputs.decoded);

          if (Option.isNone(value)) {
            return yield* whenMissing(source, Source.deriveProviderId, "derive()");
          }

          return withInputs(
            {
              raw: Option.some(Redacted.make(value.value)),
              origin: ValueOrigin.Derived,
              provider: Option.none(),
              reference: Option.none(),
              resolvedAt: Option.none(),
            },
            inputs,
          );
        }),
      Custom: (origin) => {
        const description = `custom(${origin.id})`;
        const key = customKeys.get(source);

        if (key === undefined) {
          return Effect.die("Envi resolver defect: a custom() value has no cache key.");
        }

        return Effect.gen(function* () {
          const inputs = yield* evaluateInputs(origin.inputs, description);

          const digest = yield* Digest.sha256Hex(JSON.stringify([origin.code, inputs.raws]));

          // An entry that other inputs or other code produced does not exist for this run.
          const record = Option.flatMap(Option.fromUndefinedOr(afterLock[key]), (found) =>
            found.value.pipe(
              Option.flatMap((value) => decodeCustomRecord(Redacted.value(value))),
              Option.filter((decoded) => decoded.digest === digest),
              Option.map((decoded): Cache.CacheRecord => ({
                ...found,
                value: Option.map(Option.fromNullOr(decoded.value), Redacted.make),
              })),
            ),
          );

          const fresh = Option.filter(record, (found) => isFresh(source, found));

          if (Option.isSome(fresh)) {
            return withInputs(yield* fromCached(source, fresh.value, ValueOrigin.Cache), inputs);
          }

          const outcome = yield* Effect.result(
            origin
              .call(inputs.decoded)
              .pipe(Timing.measure("custom.resolve", { reference: description })),
          );

          if (Result.isFailure(outcome)) {
            return yield* orStale(source, record, outcome.failure);
          }

          const value = outcome.success;

          // A value from an expired input is safe to cache: the digest holds the old input values.
          if (
            !isCacheDisabled(source.cachePolicy) &&
            (Option.isSome(value) || allowsMissing(source))
          ) {
            const stored = encodeCustomRecord({ digest, value: Option.getOrNull(value) });

            yield* cache.setMany({
              [key]: {
                provider: Source.customProviderId,
                reference: description,
                value: Option.some(Redacted.make(stored)),
                resolvedAt: now,
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
              resolvedAt: Option.some(now),
            },
            inputs,
          );
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
          CustomError: (error) => Effect.succeed([key, Result.fail(error)] as const),
          DecodeError: (error) => Effect.succeed([key, Result.fail(error)] as const),
          DeriveError: (error) => Effect.succeed([key, Result.fail(error)] as const),
          ProviderError: (error) => Effect.succeed([key, Result.fail(error)] as const),
          SecretReferenceError: (error) => Effect.succeed([key, Result.fail(error)] as const),
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

      // A `NotFound` counts as resolved: the provider answered, and the cache holds the answer.
      const resolved = [...keys.keys()].filter((key) => {
        const result = fetched.get(key);

        return result !== undefined && (Result.isSuccess(result) || isNotFound(result.failure));
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
