import * as EffectConfig from "effect/Config";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as Cache from "./Cache.ts";
import type { CacheSettings } from "./Config.ts";
import * as FileCache from "./FileCache.ts";

/** The inputs of the cache selection. A flag wins over a variable, and a variable over the config. */
export interface Options {
  /** The `cache` key of the config, or of the client overrides. */
  readonly settings: Option.Option<false | CacheSettings>;
  /** `true` on macOS. Without a keychain, the encrypted cache is off. */
  readonly keychainAvailable: boolean;
  /** `--cache` and `--no-cache`. */
  readonly enabled: Option.Option<boolean>;
  /** `--cache-dir`. */
  readonly directory: Option.Option<string>;
}

/** The variable that turns the cache on or off. */
export const enabledVariable = "ENVI_CACHE_ENABLED";

/** The variable of the cache directory. */
export const directoryVariable = "ENVI_CACHE_DIR";

const homeVariable = "HOME";

const ciVariable = "CI";

/** Reads a variable. A value that does not parse counts as absent, because a cache is optional. */
const read = <A>(setting: EffectConfig.Config<A>): Effect.Effect<Option.Option<A>> =>
  Effect.orElseSucceed(EffectConfig.option(setting), () => Option.none());

/**
 * Selects the cache of a run: the encrypted file cache, the plaintext file cache after an
 * explicit opt-in, or no cache. The cache is off in CI and off without a keychain.
 */
export const layer = (
  options: Options,
): Layer.Layer<Cache.Cache, never, FileSystem.FileSystem | Path.Path | FileCache.EncryptionKey> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const isCi = Option.getOrElse(yield* read(EffectConfig.Boolean(ciVariable)), () => false);
      const fromVariable = yield* read(EffectConfig.Boolean(enabledVariable));
      const settings = Option.filter(options.settings, (value) => value !== false);
      const isPlaintext = Option.exists(settings, (value) => value.encryption === "none");

      const isEnabled = options.enabled.pipe(
        Option.orElse(() => fromVariable),
        Option.getOrElse(
          () =>
            !Option.contains(options.settings, false) &&
            !isCi &&
            (options.keychainAvailable || isPlaintext),
        ),
      );

      if (!isEnabled || (!options.keychainAvailable && !isPlaintext)) {
        return Cache.layerNone;
      }

      const home = yield* read(EffectConfig.String(homeVariable));

      const fromDirectoryVariable = yield* read(EffectConfig.String(directoryVariable));

      const selected = options.directory.pipe(
        Option.orElse(() => fromDirectoryVariable),
        Option.orElse(() =>
          Option.flatMap(settings, (value) => Option.fromUndefinedOr(value.directory)),
        ),
        Option.orElse(() => Option.map(home, (value) => path.join(value, ".cache", "envi"))),
      );

      if (Option.isNone(selected)) {
        return Cache.layerNone;
      }

      return isPlaintext
        ? FileCache.layerPlaintext({ directory: selected.value })
        : FileCache.layer({ directory: selected.value });
    }),
  );
