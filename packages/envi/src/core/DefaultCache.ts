import * as EffectConfig from "effect/Config";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import * as Cache from "./Cache.ts";
import type { CacheSettings } from "./Config.ts";
import { type CacheError, CacheFailure, hints } from "./Errors.ts";
import * as FileCache from "./FileCache.ts";
import * as Settings from "./Settings.ts";

/** The inputs of the cache selection. A flag wins over a variable, and a variable over the config. */
export interface Options {
  /** The `cache` key of the config, or of the client overrides. */
  readonly settings: Option.Option<false | CacheSettings>;
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

/** Reads a variable. A value that does not parse counts as absent, because a cache is optional. */
const read = <A>(setting: EffectConfig.Config<A>): Effect.Effect<Option.Option<A>> =>
  Effect.orElseSucceed(EffectConfig.option(setting), () => Option.none());

const isKeyUnavailable = (error: CacheError): boolean =>
  error.reason === CacheFailure.KeyUnavailable;

/**
 * Turns a missing encryption key into a run without a cache and one warning. Envi reads the key
 * on the first use, so a run without a cached reference never reads it.
 */
const withoutKeyFallback = (cache: Cache.Interface): Effect.Effect<Cache.Interface> =>
  Effect.map(Ref.make(false), (off) => {
    const guarded =
      <Args extends ReadonlyArray<unknown>, A>(
        use: (target: Cache.Interface) => (...args: Args) => Effect.Effect<A, CacheError>,
      ) =>
      (...args: Args): Effect.Effect<A, CacheError> =>
        Effect.flatMap(Ref.get(off), (isOff) =>
          isOff
            ? use(Cache.none)(...args)
            : use(cache)(...args).pipe(
                Effect.catchIf(isKeyUnavailable, (error) =>
                  Effect.flatMap(Ref.getAndSet(off, true), (wasOff) =>
                    wasOff
                      ? use(Cache.none)(...args)
                      : Effect.logWarning(
                          `Envi runs without a cache. ${error.detail} ${hints.CacheError.KeyUnavailable}`,
                        ).pipe(Effect.andThen(use(Cache.none)(...args))),
                  ),
                ),
              ),
        );

    return Cache.Cache.of({
      getMany: guarded((target) => target.getMany),
      setMany: guarded((target) => target.setMany),
      removeMany: guarded((target) => target.removeMany),
      list: guarded((target) => target.list),
      clear: guarded((target) => target.clear),
      withResolveLock: (effect) =>
        Effect.flatMap(Ref.get(off), (isOff) => (isOff ? effect : cache.withResolveLock(effect))),
      directory: cache.directory,
    });
  });

/**
 * Selects the cache of a run: the encrypted file cache, the plaintext file cache after an
 * explicit opt-in, or no cache. The cache is off in CI. Without a key, the cache is off with a
 * warning, unless `--cache` or `ENVI_CACHE_ENABLED` asks for it.
 */
export const layer = (
  options: Options,
): Layer.Layer<Cache.Cache, never, FileSystem.FileSystem | Path.Path | FileCache.EncryptionKey> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const isCi = yield* Settings.isCi;
      const fromVariable = yield* read(EffectConfig.Boolean(enabledVariable));
      const explicit = Option.orElse(options.enabled, () => fromVariable);
      const settings = Option.filter(options.settings, (value) => value !== false);
      const isPlaintext = Option.exists(settings, (value) => value.encryption === "none");

      const isEnabled = Option.getOrElse(
        explicit,
        () => !Option.contains(options.settings, false) && !isCi,
      );

      if (!isEnabled) {
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

      if (isPlaintext) {
        return FileCache.layerPlaintext({ directory: selected.value });
      }

      const encrypted = FileCache.layer({ directory: selected.value });

      return Option.isSome(explicit)
        ? encrypted
        : Layer.effect(Cache.Cache, Effect.flatMap(Cache.Cache, withoutKeyFallback)).pipe(
            Layer.provide(encrypted),
          );
    }),
  );
