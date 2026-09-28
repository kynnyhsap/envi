import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";

import * as Cache from "./Cache.ts";
import * as CacheSettings from "./CacheSettings.ts";
import { defineConfig } from "./Config.ts";
import * as DefaultCache from "./DefaultCache.ts";
import * as Envi from "./Envi.ts";
import { CacheError, CacheFailure } from "./Errors.ts";
import { EncryptionKey } from "./FileCache.ts";
import { cacheRecord, nodePlatform, withEnv } from "./fixtures/Support.ts";
import { mem, memoryProvider } from "./Memory.ts";

const record = cacheRecord("value");

describe("DefaultCache", () => {
  describe("without an encryption key", () => {
    const noKey = Layer.merge(
      nodePlatform,
      Layer.succeed(
        EncryptionKey,
        Effect.fail(new CacheError({ reason: CacheFailure.KeyUnavailable, detail: "No key." })),
      ),
    );

    /** Writes and reads one record twice, and returns the warnings of the run. */
    const roundTrip = (
      overrides: CacheSettings.Overrides,
      configKey: Option.Option<CacheSettings.CacheKey>,
      directory: string,
    ) =>
      Effect.gen(function* () {
        const warnings: Array<string> = [];

        const logger = Logger.make(({ logLevel, message }) => {
          if (logLevel === "Warn") {
            warnings.push(String(message));
          }
        });

        const found = yield* Effect.gen(function* () {
          const cache = yield* Cache.Cache;

          yield* cache.setMany({ a: record });
          yield* cache.setMany({ a: record });

          return yield* cache.getMany(["a"]);
        }).pipe(
          Effect.provide(DefaultCache.layer(overrides, configKey)),
          withEnv({ HOME: directory }),
          Effect.provide(Logger.layer([logger])),
        );

        return { found, warnings };
      });

    it.effect("runs without a cache and warns once", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "envi-default-cache-" });

        const { found, warnings } = yield* roundTrip(
          CacheSettings.noOverrides,
          Option.none(),
          directory,
        );

        expect(found).toEqual({});
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain("ENVI_CACHE_KEY");
      }).pipe(Effect.provide(noKey)),
    );

    it.effect("fails when --cache asks for the cache", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "envi-default-cache-" });

        const error = yield* Effect.flip(
          roundTrip(
            { ...CacheSettings.noOverrides, enabled: Option.some(true) },
            Option.none(),
            directory,
          ),
        );

        expect(error).toMatchObject({ reason: CacheFailure.KeyUnavailable });
      }).pipe(Effect.provide(noKey)),
    );

    it.effect("uses the plaintext cache after the opt-in, which needs no key", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "envi-default-cache-" });
        const configKey = Option.some({ directory, encryption: CacheSettings.Encryption.None });

        const { found, warnings } = yield* roundTrip(
          CacheSettings.noOverrides,
          configKey,
          directory,
        );

        expect(Object.keys(found)).toEqual(["a"]);
        expect(warnings).toEqual([]);
      }).pipe(Effect.provide(noKey)),
    );

    it.effect.each([
      { encryption: CacheSettings.Encryption.Keychain, cache: false },
      { encryption: CacheSettings.Encryption.None, cache: true },
    ])(
      "reports the cache as $cache in sync with the encryption $encryption",
      ({ encryption, cache }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "envi-default-cache-" });

          const config = defineConfig({
            providers: [memoryProvider({ a: "1" })],
            vars: { A: mem("a") },
          });

          const configKey = Option.some({ directory, encryption });

          const report = yield* Envi.Envi.use((envi) => envi.sync(config)).pipe(
            Effect.provide(Envi.layer()),
            Effect.provide(DefaultCache.layer(CacheSettings.noOverrides, configKey)),
            withEnv({}),
            Effect.provide(Logger.layer([])),
          );

          expect(report.cache).toBe(cache);
        }).pipe(Effect.provide(noKey)),
    );
  });
});
