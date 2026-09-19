import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as Config from "./Config.ts";
import * as ConfigLoader from "./ConfigLoader.ts";
import { ConfigLoadFailure } from "./Errors.ts";

const layer = Layer.provideMerge(
  ConfigLoader.layer,
  Layer.mergeAll(NodeFileSystem.layer, NodePath.layer),
);

const fixture = (...segments: ReadonlyArray<string>) =>
  Effect.map(Path.Path, (path) =>
    path.join(import.meta.dirname, "fixtures", "loader", ...segments),
  );

const nameOf = (config: Config.Config) => Config.varsFor(config, "development")["NAME"]?.origin;

describe("ConfigLoader", () => {
  it.effect("loads the default export of a config file", () =>
    Effect.gen(function* () {
      const loader = yield* ConfigLoader.ConfigLoader;
      const config = yield* loader.load(yield* fixture("valid", "envi.config.ts"));

      expect(Config.isConfig(config)).toBe(true);
      expect(nameOf(config)).toMatchObject({ value: "valid" });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fails with NotFound, InvalidConfig, and ImportFailed", () =>
    Effect.gen(function* () {
      const loader = yield* ConfigLoader.ConfigLoader;
      const missing = yield* Effect.flip(loader.load(yield* fixture("nope", "envi.config.ts")));
      const invalid = yield* Effect.flip(loader.load(yield* fixture("invalid", "envi.config.ts")));
      const throwing = yield* Effect.flip(loader.load(yield* fixture("throws", "envi.config.ts")));

      const extension = yield* Effect.flip(
        loader.load(yield* fixture("workspace", "package.json")),
      );

      expect(missing.reason).toBe(ConfigLoadFailure.NotFound);
      expect(invalid.reason).toBe(ConfigLoadFailure.InvalidConfig);
      expect(throwing.reason).toBe(ConfigLoadFailure.ImportFailed);
      expect(throwing.message).not.toContain("secret-in-config-error");
      expect(extension.reason).toBe(ConfigLoadFailure.InvalidConfig);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reports an install hint for an import that does not resolve", () =>
    Effect.gen(function* () {
      const loader = yield* ConfigLoader.ConfigLoader;

      const error = yield* Effect.flip(
        loader.load(yield* fixture("missing-dependency", "envi.config.ts")),
      );

      expect(error.reason).toBe(ConfigLoadFailure.MissingDependency);
      expect(error.detail).toContain("Install Envi");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("finds the nearest config file of a directory", () =>
    Effect.gen(function* () {
      const loader = yield* ConfigLoader.ConfigLoader;
      const found = yield* loader.findNearest(yield* fixture("valid", "nested", "deep"));

      expect(found).toBe(yield* fixture("valid", "envi.config.ts"));
    }).pipe(Effect.provide(layer)),
  );

  it.effect("finds the config files of a workspace", () =>
    Effect.gen(function* () {
      const loader = yield* ConfigLoader.ConfigLoader;
      const root = yield* fixture("workspace");
      const found = yield* loader.findWorkspace(root);

      expect(found).toEqual([
        yield* fixture("workspace", "envi.config.ts"),
        yield* fixture("workspace", "packages", "api", "envi.config.ts"),
        yield* fixture("workspace", "packages", "web", "envi.config.ts"),
        yield* fixture("workspace", "tools", "cli", "envi.config.mts"),
      ]);
    }).pipe(Effect.provide(layer)),
  );
});
