import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as CacheSettings from "./core/CacheSettings.ts";
import * as DefaultCache from "./core/DefaultCache.ts";
import * as Envi from "./core/Envi.ts";
import type { SettingsError } from "./core/Errors.ts";
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
  const overrides: CacheSettings.Overrides = {
    ...CacheSettings.noOverrides,
    option: Option.fromUndefinedOr(options.cache),
  };

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
