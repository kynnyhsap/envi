import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import * as Cache from "./Cache.ts";
import * as DefaultCache from "./DefaultCache.ts";
import { layerEncryptionKey } from "./FileCache.ts";

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
  keychainAvailable: true,
  enabled: Option.none(),
  directory: Option.none(),
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

  it.effect("is off without a keychain, unless the config opts in to plaintext", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "envi-default-cache-" });
      const env = { HOME: "/home/dev" };
      const plaintext = Option.some({ directory, encryption: "none" as const });

      expect(yield* directoryOf({ ...base, keychainAvailable: false }, env)).toEqual(Option.none());
      expect(
        yield* directoryOf({ ...base, keychainAvailable: false, settings: plaintext }, env),
      ).toEqual(Option.some(directory));
    }).pipe(Effect.provide(platform)),
  );
});
