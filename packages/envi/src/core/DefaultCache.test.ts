import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import * as Cache from "./Cache.ts";
import * as DefaultCache from "./DefaultCache.ts";
import { CacheError, CacheFailure } from "./Errors.ts";
import { EncryptionKey, layerEncryptionKey } from "./FileCache.ts";

const platform = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  layerEncryptionKey(Redacted.make(new Uint8Array(32).fill(7))),
);

const directoryOf = (options: DefaultCache.Options, env: Readonly<Record<string, string>>) =>
  Effect.map(Cache.Cache, (cache) => cache.directory).pipe(
    Effect.provide(DefaultCache.layer(options)),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
  );

const base: DefaultCache.Options = {
  settings: Option.none(),
  enabled: Option.none(),
  directory: Option.none(),
};

const record: Cache.CacheRecord = {
  provider: "memory",
  reference: "a",
  value: Option.some(Redacted.make("value")),
  resolvedAt: 0,
};

describe("DefaultCache", () => {
  it.effect("uses ~/.cache/envi by default", () =>
    Effect.gen(function* () {
      expect(yield* directoryOf(base, { HOME: "/home/dev" })).toEqual(
        Option.some("/home/dev/.cache/envi"),
      );
    }).pipe(Effect.provide(platform)),
  );

  it.effect("picks the directory from the flag, then the variable, then the config", () =>
    Effect.gen(function* () {
      const settings = Option.some({ directory: "/from/config" });
      const env = { HOME: "/home/dev", ENVI_CACHE_DIR: "/from/env" };

      expect(
        yield* directoryOf({ ...base, settings, directory: Option.some("/from/flag") }, env),
      ).toEqual(Option.some("/from/flag"));
      expect(yield* directoryOf({ ...base, settings }, env)).toEqual(Option.some("/from/env"));
      expect(yield* directoryOf({ ...base, settings }, { HOME: "/home/dev" })).toEqual(
        Option.some("/from/config"),
      );
    }).pipe(Effect.provide(platform)),
  );

  it.effect("is off in CI, and the variable or the flag turns it on", () =>
    Effect.gen(function* () {
      const ci = { HOME: "/home/dev", CI: "true" };

      expect(yield* directoryOf(base, ci)).toEqual(Option.none());
      expect(yield* directoryOf(base, { ...ci, ENVI_CACHE_ENABLED: "true" })).toEqual(
        Option.some("/home/dev/.cache/envi"),
      );
      expect(yield* directoryOf({ ...base, enabled: Option.some(true) }, ci)).toEqual(
        Option.some("/home/dev/.cache/envi"),
      );
    }).pipe(Effect.provide(platform)),
  );

  it.effect("is off with `cache: false` and with the flag", () =>
    Effect.gen(function* () {
      const env = { HOME: "/home/dev" };

      expect(yield* directoryOf({ ...base, settings: Option.some(false) }, env)).toEqual(
        Option.none(),
      );
      expect(yield* directoryOf({ ...base, enabled: Option.some(false) }, env)).toEqual(
        Option.none(),
      );
    }).pipe(Effect.provide(platform)),
  );

  describe("without an encryption key", () => {
    const noKey = Layer.mergeAll(
      NodeFileSystem.layer,
      NodePath.layer,
      Layer.succeed(
        EncryptionKey,
        Effect.fail(new CacheError({ reason: CacheFailure.KeyUnavailable, detail: "No key." })),
      ),
    );

    /** Writes and reads one record twice, and returns the warnings of the run. */
    const roundTrip = (options: DefaultCache.Options, directory: string) =>
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
          Effect.provide(DefaultCache.layer(options)),
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: directory }))),
          Effect.provide(Logger.layer([logger])),
        );

        return { found, warnings };
      });

    it.effect("runs without a cache and warns once", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "envi-default-cache-" });
        const { found, warnings } = yield* roundTrip(base, directory);

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
          roundTrip({ ...base, enabled: Option.some(true) }, directory),
        );

        expect(error.reason).toBe(CacheFailure.KeyUnavailable);
      }).pipe(Effect.provide(noKey)),
    );

    it.effect("uses the plaintext cache after the opt-in, which needs no key", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "envi-default-cache-" });
        const settings = Option.some({ directory, encryption: "none" as const });
        const { found, warnings } = yield* roundTrip({ ...base, settings }, directory);

        expect(Object.keys(found)).toEqual(["a"]);
        expect(warnings).toEqual([]);
      }).pipe(Effect.provide(noKey)),
    );
  });
});
