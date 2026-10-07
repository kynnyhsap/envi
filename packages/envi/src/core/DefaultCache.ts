import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import * as Cache from "./Cache.ts";
import * as CacheSettings from "./CacheSettings.ts";
import { type CacheError, CacheFailure, hints, type SettingsError } from "./Errors.ts";
import * as FileCache from "./FileCache.ts";

const isKeyUnavailable = (error: CacheError): boolean =>
  error.reason === CacheFailure.KeyUnavailable;

/**
 * Turns a missing encryption key into a run without a cache and one warning. Envi reads the key
 * on the first use, so a run without a cached reference never reads it.
 */
const withoutKeyFallback = (
  cache: Cache.Interface,
): Effect.Effect<readonly [Cache.Interface, Effect.Effect<boolean>]> =>
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

    const guardedCache = Cache.Cache.of({
      getMany: guarded((target) => target.getMany),
      setMany: guarded((target) => target.setMany),
      list: guarded((target) => target.list),
      clear: guarded((target) => target.clear),
      withResolveLock: (effect) =>
        Effect.flatMap(Ref.get(off), (isOff) => (isOff ? effect : cache.withResolveLock(effect))),
    });

    return [guardedCache, Effect.map(Ref.get(off), (isOff) => !isOff)] as const;
  });

/** Logs the cache that the settings select: on or off, the directory, and the encryption. */
const logSelection = (selection: CacheSettings.Selection) =>
  Effect.logDebug("Envi selected the cache.").pipe(
    Effect.annotateLogs({
      enabled: selection.enabled,
      directory: Option.getOrElse(selection.directory, () => "none"),
      encryption: selection.encryption,
    }),
  );

/**
 * Selects the cache of a run with `CacheSettings.select`: the encrypted file cache, the plaintext
 * file cache after an explicit opt-in, or no cache. Without a key, the cache is off with a warning,
 * unless `--cache` or `ENVI_CACHE_ENABLED` asks for it.
 */
export const layer = (
  overrides: CacheSettings.Overrides,
  configKey: Option.Option<unknown>,
): Layer.Layer<
  Cache.Cache | Cache.Status,
  SettingsError,
  FileSystem.FileSystem | Path.Path | FileCache.EncryptionKey
> =>
  Layer.unwrap(
    Effect.map(
      Effect.tap(CacheSettings.select(overrides, configKey), logSelection),
      (selection) => {
        if (!selection.enabled || Option.isNone(selection.directory)) {
          return Cache.layerNone;
        }

        const directory = selection.directory.value;

        const status = (active: Effect.Effect<boolean>) =>
          Layer.succeed(Cache.Status, { directory: Option.some(directory), active });

        if (selection.encryption === CacheSettings.Encryption.None) {
          return Layer.merge(FileCache.layerPlaintext({ directory }), status(Effect.succeed(true)));
        }

        const encrypted = FileCache.layer({ directory });

        if (selection.explicit) {
          return Layer.merge(encrypted, status(Effect.succeed(true)));
        }

        return Layer.unwrap(
          Effect.map(Effect.flatMap(Cache.Cache, withoutKeyFallback), ([cache, active]) =>
            Layer.merge(Layer.succeed(Cache.Cache, cache), status(active)),
          ),
        ).pipe(Layer.provide(encrypted));
      },
    ),
  );
