import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type { CacheSettings } from "./core/Config.ts";
import * as DefaultCache from "./core/DefaultCache.ts";
import * as Envi from "./core/Envi.ts";
import * as Keychain from "./core/Keychain.ts";
import type { Provider } from "./core/Provider.ts";
import * as Signals from "./signals.ts";

/** The settings of a client or a layer. They win over the config. */
export interface EnviOptions {
  /** Replaces the providers of the config. Tests pass an in-memory provider here. */
  readonly providers?: ReadonlyArray<Provider>;
  /** `false` turns the cache off. An object replaces the `cache` key of the config. */
  readonly cache?: false | CacheSettings;
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
export type Services = Envi.Envi | Envi.ParentEnvironment | NodeServices.NodeServices;

/**
 * The `Envi` service on Node or Bun: the default cache with its key from `ENVI_CACHE_KEY` or
 * the OS keychain, the environment of the process, the signals of the process, and the platform
 * services.
 * `createEnvi` runs on the same layer. The service serves any config, so the cache settings come
 * from `options.cache`, not from the `cache` key of a config.
 *
 * @example
 * program.pipe(Effect.provide(layer({ strict: true })));
 */
export const layer = (options: EnviOptions = {}): Layer.Layer<Services> => {
  const cache = DefaultCache.layer({
    settings: Option.fromUndefinedOr(options.cache),
    enabled: Option.none(),
    directory: Option.none(),
  }).pipe(Layer.provide(Keychain.layer(keyStoreOf(process.platform))));

  return Layer.mergeAll(
    Envi.layer(options).pipe(Layer.provide(cache)),
    Signals.layer,
    Layer.succeed(Envi.ParentEnvironment, process.env),
  ).pipe(Layer.provideMerge(NodeServices.layer));
};
