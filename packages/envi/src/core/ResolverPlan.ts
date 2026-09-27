// Step 1 of a resolution: walk every descriptor and every input, prepare each reference with its
// provider, derive each cache key, and decode the cache durations of each descriptor.
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import type * as Schema from "effect/Schema";

import * as CacheSettings from "./CacheSettings.ts";
import * as Digest from "./Digest.ts";
import { SettingsError, type VarError } from "./Errors.ts";
import * as Provider from "./Provider.ts";
import * as Source from "./Source.ts";

/** One prepared reference. `fullKey` is its cache key. */
export interface Leaf {
  readonly fullKey: string;
  readonly provider: Provider.Provider;
  readonly reference: Schema.Json;
  readonly description: string;
}

/** The freshness limits of one descriptor. */
export interface Durations {
  readonly ttl: Duration.Duration;
  readonly maxStale: Duration.Duration;
}

/** The settings of a resolution that the plan needs. */
export interface Settings extends Durations {
  /** A `custom()` value keeps one cache entry for each stage. */
  readonly stage: string;
}

/** Everything that the later steps know about the descriptors of one resolution. */
export interface Plan {
  /** Every descriptor and every input, each once. */
  readonly all: ReadonlyArray<Source.AnySource>;
  readonly leaves: ReadonlyMap<Source.AnySource, Result.Result<Leaf, VarError>>;
  readonly customKeys: ReadonlyMap<Source.AnySource, string>;
  readonly durations: ReadonlyMap<Source.AnySource, Durations>;
  /** The durations of the config, for a descriptor without its own. */
  readonly defaults: Durations;
}

/** The hex digits of the scope hash in a cache key. 64 bits keep two scopes apart. */
const scopeHashLength = 16;

/** The hex digits of the stage and scope hash in the cache key of a `custom()` value. */
const customHashLength = 16;

export const isCustom = Source.Origin.$is("Custom");

export const isDerived = Source.Origin.$is("Derived");

export const isReference = Source.Origin.$is("Reference");

/** The inputs of a `derive()` or `custom()` value, by input name. */
const inputsOf = (source: Source.AnySource): ReadonlyArray<readonly [string, Source.AnySource]> =>
  isCustom(source.origin) || isDerived(source.origin) ? Object.entries(source.origin.inputs) : [];

/** Every descriptor and every input, each with the first path that reaches it. */
const collect = (
  sources: Readonly<Record<string, Source.AnySource>>,
): ReadonlyMap<Source.AnySource, string> => {
  const paths = new Map<Source.AnySource, string>();

  const visit = (source: Source.AnySource, path: string): void => {
    if (paths.has(source)) {
      return;
    }

    paths.set(source, path);

    for (const [name, input] of inputsOf(source)) {
      visit(input, `${path}.${name}`);
    }
  };

  for (const [key, source] of Object.entries(sources)) {
    visit(source, `vars.${key}`);
  }

  return paths;
};

/** One duration of a `.cache()` override. `path` names the descriptor in the error. */
const durationAt = (
  input: Option.Option<Duration.Input>,
  fallback: Duration.Duration,
  path: string,
  field: "ttl" | "maxStale",
): Effect.Effect<Duration.Duration, SettingsError> =>
  Option.match(input, {
    onNone: () => Effect.succeed(fallback),
    onSome: (value) =>
      Option.match(Duration.fromInput(value), {
        onNone: () =>
          Effect.fail(
            new SettingsError({
              name: `${path}.cache.${field}`,
              expected: CacheSettings.expected[field],
            }),
          ),
        onSome: Effect.succeed,
      }),
  });

const decodeDurations = (
  source: Source.AnySource,
  path: string,
  settings: Settings,
): Effect.Effect<Durations, SettingsError> =>
  Source.CachePolicy.$match(source.cachePolicy, {
    Inherit: () => Effect.succeed({ ttl: settings.ttl, maxStale: settings.maxStale }),
    Disabled: () => Effect.succeed({ ttl: Duration.zero, maxStale: settings.maxStale }),
    Override: (policy) =>
      Effect.all({
        ttl: durationAt(policy.ttl, settings.ttl, path, "ttl"),
        maxStale: durationAt(policy.maxStale, settings.maxStale, path, "maxStale"),
      }),
  });

/** Plans one resolution. An invalid `.cache()` duration fails it before any cache read. */
export const make = Effect.fn("ResolverPlan.make")(function* (
  sources: Readonly<Record<string, Source.AnySource>>,
  settings: Settings,
) {
  const providers = yield* Provider.Providers;
  const paths = collect(sources);
  const all = [...paths.keys()];

  const durations = new Map(
    yield* Effect.forEach(paths, ([source, path]) =>
      Effect.map(decodeDurations(source, path, settings), (found) => [source, found] as const),
    ),
  );

  // The scope can hold a credential. Only its hash enters a cache key.
  const scopeHashes = new Map(
    yield* Effect.forEach(providers.all, (provider) =>
      Effect.map(
        Effect.result(Effect.flatMap(provider.scope, Digest.sha256Hex)),
        (hash) => [provider.id, hash] as const,
      ),
    ),
  );

  const leaves = new Map<Source.AnySource, Result.Result<Leaf, VarError>>();

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
      const hash = yield* Digest.sha256Hex(JSON.stringify([settings.stage, source.origin.scope]));

      customKeys.set(
        source,
        `${Source.customProviderId}:${source.origin.id}:${hash.slice(0, customHashLength)}`,
      );
    }
  }

  const plan: Plan = {
    all,
    leaves,
    customKeys,
    durations,
    defaults: { ttl: settings.ttl, maxStale: settings.maxStale },
  };

  return plan;
});

/** The prepared reference of a descriptor. None for another origin or a failed preparation. */
export const leafOf = (plan: Plan, source: Source.AnySource): Option.Option<Leaf> => {
  const leaf = plan.leaves.get(source);

  return leaf !== undefined && Result.isSuccess(leaf) ? Option.some(leaf.success) : Option.none();
};

/** The cache key of a descriptor: a `custom()` key or the key of a prepared reference. */
export const cacheKeyOf = (plan: Plan, source: Source.AnySource): Option.Option<string> =>
  Option.orElse(Option.fromUndefinedOr(plan.customKeys.get(source)), () =>
    Option.map(leafOf(plan, source), (leaf) => leaf.fullKey),
  );

/** Every cache key of the plan, each once. */
export const cacheKeys = (plan: Plan): ReadonlyArray<string> => [
  ...new Set(plan.all.flatMap((source) => Option.toArray(cacheKeyOf(plan, source)))),
];

/**
 * The references that can need a provider call. Envi evaluates every input of a `custom()` value,
 * because the inputs decide whether its entry still fits.
 */
export const references = (plan: Plan): ReadonlyArray<Source.AnySource> =>
  plan.all.filter((source) => isReference(source.origin));

/** The durations of a descriptor. The plan holds them for every descriptor of the resolution. */
export const durationsOf = (plan: Plan, source: Source.AnySource): Durations =>
  plan.durations.get(source) ?? plan.defaults;
