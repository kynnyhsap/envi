import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Equivalence from "effect/Equivalence";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Record from "effect/Record";

import * as CacheSettings from "./core/CacheSettings.ts";
import type * as Config from "./core/Config.ts";
import * as DefaultCache from "./core/DefaultCache.ts";
import * as Envi from "./core/Envi.ts";
import { SettingsError } from "./core/Errors.ts";
import * as Keychain from "./core/Keychain.ts";
import type { Provider } from "./core/Provider.ts";
import * as Platform from "./platform.ts";
import * as Signals from "./signals.ts";

/** The settings of a client or a layer. They win over the config. */
export interface EnviOptions {
  /** Replaces the providers of the config. Tests pass an in-memory provider here. */
  readonly providers?: ReadonlyArray<Provider>;
  /** `false` turns the cache off. An object replaces the `cache` key of the config. */
  readonly cache?: CacheSettings.CacheKey;
  readonly strict?: boolean;
  /** Allows a prompt, such as a desktop app approval. Default: `ENVI_INTERACTIVE`, then not CI. */
  readonly interactive?: boolean;
}

/** The keychain of a platform: the macOS Keychain, the Secret Service on Linux, or none. */
export const keyStoreOf = (platform: string): Keychain.Store => {
  if (platform === "darwin") {
    return Keychain.Store.MacOs;
  }

  return platform === "linux" ? Keychain.Store.SecretService : Keychain.Store.None;
};

/** The services of the `Envi` layer. `run` needs the environment and the platform services. */
export type Services = Envi.Envi | Envi.ParentEnvironment | Platform.Services;

/** The cache settings of a client or a layer. */
const overridesOf = (options: EnviOptions): CacheSettings.Overrides => ({
  ...CacheSettings.noOverrides,
  option: Option.fromUndefinedOr(options.cache),
});

/**
 * The `Envi` service on Node or Bun of one config: the default cache with its key from
 * `ENVI_CACHE_KEY` or the OS keychain, the environment of the process, the signals of the
 * process, and the platform services. The cache directory and the encryption come from
 * `options.cache`, then from `configKey`. `createEnvi` passes the `cache` key of its config.
 */
export const layerOf = (
  options: EnviOptions,
  configKey: Option.Option<CacheSettings.CacheKey>,
): Layer.Layer<Services, SettingsError> => {
  const overrides = overridesOf(options);

  const cache = DefaultCache.layer(overrides, configKey).pipe(
    Layer.provide(Keychain.layer(keyStoreOf(process.platform))),
  );

  return Layer.mergeAll(
    Envi.layer({ ...options, cache: overrides }).pipe(Layer.provide(cache)),
    Signals.layer,
    Layer.succeed(Envi.ParentEnvironment, process.env),
  ).pipe(Layer.provideMerge(Platform.layer));
};

/**
 * The `Envi` service of a sync of several configs. The first config that uses the cache selects
 * the cache, so a config with the cache off never turns it off for the others. It fails when the
 * configs select another encryption or directory.
 */
export const syncLayerOf = (
  options: EnviOptions,
  configs: ReadonlyArray<Config.Config>,
): Layer.Layer<Services, SettingsError> =>
  Layer.unwrap(
    Effect.map(CacheSettings.requireOneStorage(overridesOf(options), configs), (configKey) =>
      layerOf(options, configKey),
    ),
  );

/** The same provider instances in the same order. Another instance of a provider differs. */
const sameProviders = Equivalence.make<ReadonlyArray<Provider> | undefined>((self, that) =>
  self === undefined || that === undefined
    ? self === that
    : Arr.makeEquivalence(Equivalence.strictEqual<Provider>())(self, that),
);

/** The comparison of each override of a client. */
const sameOverride: Readonly<Record<keyof EnviOptions, Equivalence.Equivalence<EnviOptions>>> = {
  providers: (self, that) => sameProviders(self.providers, that.providers),
  cache: (self, that) => Equal.equals(self.cache, that.cache),
  strict: (self, that) => self.strict === that.strict,
  interactive: (self, that) => self.interactive === that.interactive,
};

/**
 * The `Envi` service of a sync of the configs of several clients. One sync has one set of
 * overrides, so it fails when a client has other overrides than the first client.
 */
export const syncAllLayerOf = (
  options: readonly [EnviOptions, ...ReadonlyArray<EnviOptions>],
  configs: ReadonlyArray<Config.Config>,
): Layer.Layer<Services, SettingsError> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const [first] = options;

      for (const [index, other] of options.entries()) {
        const field = Record.keys(sameOverride).find((key) => !sameOverride[key](first, other));

        if (field !== undefined) {
          return yield* new SettingsError({
            name: `option ${field}`,
            expected: `one value for every client of syncAll, but client ${index + 1} has another value than client 1`,
          });
        }
      }

      return syncLayerOf(first, configs);
    }),
  );

/**
 * The `Envi` service on Node or Bun for any config. The cache directory and the encryption come
 * from `options.cache`. The `cache` key of each config still sets its `ttl`, its `maxStale`, and
 * `false`, unless `options.cache` replaces it. `sync` of several configs still requires that every
 * config that uses the cache selects the same encryption and directory.
 *
 * @example
 * program.pipe(Effect.provide(layer({ strict: true })));
 */
export const layer = (options: EnviOptions = {}): Layer.Layer<Services, SettingsError> =>
  layerOf(options, Option.none());
