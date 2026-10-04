// The cache settings: the schema of the `cache` key, and the one precedence order that selects the
// cache of a run. The cache layer and the `Envi` service both select through this module.
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

import { SettingsError } from "./Errors.ts";
import * as Settings from "./Settings.ts";

/** The encryption of the file cache. */
export const Encryption = {
  /** AES-256-GCM with a key from `ENVI_CACHE_KEY` or the OS keychain. */
  Keychain: "keychain",
  /** Plaintext files with the mode `0600`. Envi never selects it on its own. */
  None: "none",
} as const;

/** The schema of `Encryption`. */
const EncryptionSchema = Schema.Enum(Encryption);

export type Encryption = typeof EncryptionSchema.Type;

/** A duration, such as `"24 hours"`, or a number of milliseconds. */
const DurationInput = Schema.declare((input: unknown): input is Duration.Input =>
  // SAFETY: `fromInput` returns none for any input that is not a duration.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  Option.isSome(Duration.fromInput(input as Duration.Input)),
);

/** The cache settings of a config, or of the `cache` option of a client or a layer. */
export const CacheSettings = Schema.Struct({
  directory: Schema.optionalKey(Schema.String),
  /** `"none"` writes plaintext files with the mode `0600`. Envi never selects it on its own. */
  encryption: Schema.optionalKey(EncryptionSchema),
  /** The refresh interval. Default: 24 hours. */
  ttl: Schema.optionalKey(DurationInput),
  /** The longest time that Envi uses an expired entry after a transient failure. Default: 7 days. */
  maxStale: Schema.optionalKey(DurationInput),
});

export type CacheSettings = typeof CacheSettings.Type;

/** The `cache` key: `false` turns the cache off. */
export type CacheKey = false | CacheSettings;

/** What each field of `CacheSettings` expects. `SettingsError` names it. */
export const expected: Readonly<Record<keyof typeof CacheSettings.fields, string>> = {
  directory: "a folder path",
  encryption: `"${Encryption.Keychain}" or "${Encryption.None}"`,
  ttl: 'a duration, such as "24 hours"',
  maxStale: 'a duration, such as "7 days"',
};

/** The default refresh interval of a cache entry: 24 hours. */
const defaultTtl: Duration.Duration = Duration.days(1);

/** The default limit of the stale fallback: 7 days. */
export const defaultMaxStale: Duration.Duration = Duration.weeks(1);

/** The variable that turns the cache on or off. */
const enabledVariable = "ENVI_CACHE_ENABLED";

/** The variable of the cache directory. */
const directoryVariable = "ENVI_CACHE_DIR";

/** The settings above the config: the flags of the CLI, and the `cache` option. */
export interface Overrides {
  /** `--cache` and `--no-cache`. */
  readonly enabled: Option.Option<boolean>;
  /** `--cache-dir`. */
  readonly directory: Option.Option<string>;
  /** The `cache` option of a client or a layer. It replaces the `cache` key of the config. */
  readonly option: Option.Option<CacheKey>;
}

/** No flag and no option. */
export const noOverrides: Overrides = {
  enabled: Option.none(),
  directory: Option.none(),
  option: Option.none(),
};

/** How a run uses the cache, after the precedence order. The `Envi` service selects it per config. */
export interface Policy {
  /** `false` when a setting turns the cache off. */
  readonly enabled: boolean;
  /** A flag or `ENVI_CACHE_ENABLED` asks for the cache. Then a missing key fails the run. */
  readonly explicit: boolean;
  readonly encryption: Encryption;
  readonly ttl: Duration.Duration;
  readonly maxStale: Duration.Duration;
}

/** The policy and the directory of the cache of a run. The cache layer selects it. */
export interface Selection extends Policy {
  /** None without `HOME` and without a selected directory. */
  readonly directory: Option.Option<string>;
}

const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

const decodeField = Schema.decodeUnknownOption(Schema.Literals(Record.keys(CacheSettings.fields)));

/** Decodes one `cache` key. `name` names it in the error: `cache`, or `option cache`. */
const decodeKey = (
  name: string,
  key: Option.Option<unknown>,
): Effect.Effect<Option.Option<CacheKey>, SettingsError> =>
  Option.match(key, {
    onNone: () => Effect.succeedNone,
    onSome: (value) =>
      value === false
        ? Effect.succeedSome<CacheKey>(false)
        : Schema.decodeUnknownEffect(CacheSettings)(value).pipe(
            Effect.map((settings) => Option.some<CacheKey>(settings)),
            Effect.mapError((error) => {
              const failed = decodeField(formatIssue(error.issue).issues[0]?.path?.[0]);

              return Option.match(failed, {
                onNone: () =>
                  new SettingsError({ name, expected: "false, or an object of cache settings" }),
                onSome: (field) =>
                  new SettingsError({ name: `${name}.${field}`, expected: expected[field] }),
              });
            }),
          ),
  });

/** `false` when the key turns the cache off. */
const offAt = (key: Option.Option<CacheKey>): Option.Option<boolean> =>
  Option.contains(key, false) ? Option.some(false) : Option.none();

/** One field of a key that is not `false`. */
const fieldAt = <K extends keyof CacheSettings>(
  key: Option.Option<CacheKey>,
  field: K,
): Option.Option<NonNullable<CacheSettings[K]>> =>
  Option.flatMap(key, (value) =>
    value === false ? Option.none() : Option.fromUndefinedOr(value[field]),
  );

/** A duration from the option, then from the config key, then the default. */
const durationAt = (
  option: Option.Option<CacheKey>,
  config: Option.Option<CacheKey>,
  field: "ttl" | "maxStale",
  fallback: Duration.Duration,
): Duration.Duration =>
  Option.match(Option.firstSomeOf([fieldAt(option, field), fieldAt(config, field)]), {
    onNone: () => fallback,
    onSome: Duration.fromInputUnsafe,
  });

/**
 * Applies the order of every setting: a flag, the `cache` option, a variable, the `cache` key of
 * the config, a default. The option replaces the whole config key. `decided` is the first setting
 * that turns the cache on or off. Envi reads `ENVI_CACHE_ENABLED` only when no setting above it
 * decides.
 */
const decide = Effect.fn("CacheSettings.decide")(function* (
  overrides: Overrides,
  configKey: Option.Option<unknown>,
) {
  const option = yield* decodeKey("option cache", overrides.option);
  const config = Option.isSome(option) ? Option.none() : yield* decodeKey("cache", configKey);

  const decidedAbove = Option.orElse(overrides.enabled, () => offAt(option));

  const enabledFromVariable = yield* Option.match(decidedAbove, {
    onSome: () => Effect.succeedNone,
    onNone: () => Settings.readBoolean(enabledVariable),
  });

  const decided = Option.firstSomeOf([decidedAbove, enabledFromVariable, offAt(config)]);

  const policy: Policy = {
    enabled: Option.getOrElse(decided, () => true),
    explicit: Option.isSome(Option.orElse(overrides.enabled, () => enabledFromVariable)),
    encryption: Option.getOrElse(
      Option.firstSomeOf([fieldAt(option, "encryption"), fieldAt(config, "encryption")]),
      () => Encryption.Keychain,
    ),
    ttl: durationAt(option, config, "ttl", defaultTtl),
    maxStale: durationAt(option, config, "maxStale", defaultMaxStale),
  };

  return { option, config, decided, policy };
});

/**
 * Selects the policy of one config. Without a setting that decides, the policy leaves the cache
 * on, and the cache layer decides: the default cache is off in CI.
 */
export const selectPolicy = (
  overrides: Overrides,
  configKey: Option.Option<unknown>,
): Effect.Effect<Policy, SettingsError> =>
  Effect.map(decide(overrides, configKey), ({ policy }) => policy);

/**
 * The policy of the default cache, and the directory that a setting names. Without a setting that
 * decides, the cache is off in CI. A directory of none selects the default folder in `HOME`.
 */
const decideStorage = Effect.fn("CacheSettings.decideStorage")(function* (
  overrides: Overrides,
  configKey: Option.Option<unknown>,
) {
  const { option, config, decided, policy } = yield* decide(overrides, configKey);
  const isCi = yield* Settings.isCi;

  const directoryAbove = Option.orElse(overrides.directory, () => fieldAt(option, "directory"));

  const directoryFromVariable = yield* Option.match(directoryAbove, {
    onSome: () => Effect.succeedNone,
    onNone: () => Settings.readString(directoryVariable, expected.directory),
  });

  const selection: Selection = {
    ...policy,
    enabled: Option.getOrElse(decided, () => !isCi),
    directory: Option.firstSomeOf([
      directoryAbove,
      directoryFromVariable,
      fieldAt(config, "directory"),
    ]),
  };

  return selection;
});

/**
 * Selects the policy and the directory of the default cache, with the same order. Without a
 * setting that decides, the cache is off in CI.
 */
export const select = Effect.fn("CacheSettings.select")(function* (
  overrides: Overrides,
  configKey: Option.Option<unknown>,
) {
  const path = yield* Path.Path;
  const selection = yield* decideStorage(overrides, configKey);
  const home = yield* Settings.home;

  return {
    ...selection,
    directory: Option.orElse(selection.directory, () =>
      Option.map(home, (value) => path.join(value, ".cache", "envi")),
    ),
  } satisfies Selection;
});

/** One config of a sync: its file and its `cache` key. */
export interface ConfigCache {
  readonly path: Option.Option<string>;
  readonly cache: Option.Option<CacheKey>;
}

/**
 * The storage settings that every config of one sync must share, each as an error shows it. Two
 * configs share a setting when it shows the same text. It is never a secret.
 */
const storage: Readonly<Record<"encryption" | "directory", (selection: Selection) => string>> = {
  encryption: (selection) => `"${selection.encryption}"`,
  directory: (selection) =>
    Option.match(selection.directory, {
      onNone: () => "the default folder",
      onSome: (directory) => `"${directory}"`,
    }),
};

/**
 * Fails when two configs of one sync select another encryption or another directory. One sync
 * fills one cache, so a config never gets the storage of another config. A config with the cache
 * off writes nothing, so its storage does not count.
 *
 * Returns the `cache` key that selects the cache of the sync: the key of the first config that
 * uses the cache, or the key of the first config when none does. A config with the cache off thus
 * never turns the cache off for the others.
 */
export const requireOneStorage = Effect.fn("CacheSettings.requireOneStorage")(function* (
  overrides: Overrides,
  configs: ReadonlyArray<ConfigCache>,
) {
  const selected = yield* Effect.forEach(configs, (config, index) =>
    Effect.map(decideStorage(overrides, config.cache), (selection) => ({
      name: Option.getOrElse(config.path, () => `config ${index + 1}`),
      cache: config.cache,
      selection,
    })),
  );

  const [first, ...rest] = selected.filter(({ selection }) => selection.enabled);

  if (first === undefined) {
    return Option.flatMap(Option.fromUndefinedOr(configs[0]), (config) => config.cache);
  }

  for (const [field, show] of Object.entries(storage)) {
    const other = rest.find(({ selection }) => show(selection) !== show(first.selection));

    if (other !== undefined) {
      return yield* new SettingsError({
        name: `cache.${field}`,
        expected: `one value for every config of a sync, but ${first.name} selects ${show(first.selection)} and ${other.name} selects ${show(other.selection)}`,
      });
    }
  }

  return first.cache;
});
