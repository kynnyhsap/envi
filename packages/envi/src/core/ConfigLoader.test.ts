import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";

import * as Config from "./Config.ts";
import * as ConfigLoader from "./ConfigLoader.ts";
import { ConfigLoadFailure } from "./Errors.ts";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const layer = Layer.provideMerge(
  ConfigLoader.layer,
  Layer.provideMerge(NodeChildProcessSpawner.layer, platform),
);

const { Down, Repo, Up } = ConfigLoader.ConfigSearch;

/** Writes empty config files and folders into a temp folder, and returns the folder. */
const tree = (files: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "envi-find-" }));

    yield* Effect.forEach(files, (file) =>
      Effect.gen(function* () {
        const absolute = path.join(root, file);

        yield* fs.makeDirectory(file.endsWith("/") ? absolute : path.dirname(absolute), {
          recursive: true,
        });

        if (!file.endsWith("/")) {
          yield* fs.writeFileString(absolute, file.endsWith(".gitignore") ? "ignored/\n" : "");
        }
      }),
    );

    return root;
  });

const gitInit = (directory: string) =>
  Effect.flatMap(ChildProcessSpawner, (spawner) =>
    spawner.exitCode(ChildProcess.make("git", ["init", "-q"], { cwd: directory, stdin: "ignore" })),
  );

/** Runs a search with the given HOME, and returns the paths relative to the root. */
const find = (root: string, from: string, search: ConfigLoader.ConfigSearch, home = "/nowhere") =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const loader = yield* ConfigLoader.ConfigLoader;

    const found = yield* loader
      .find(path.join(root, from), search)
      .pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: home }))));

    return found.map((file) => path.relative(root, file));
  });

const fixture = (...segments: ReadonlyArray<string>) =>
  Effect.map(Path.Path, (path) =>
    path.join(import.meta.dirname, "fixtures", "loader", ...segments),
  );

const nameOf = (config: Config.Config) =>
  Effect.map(Config.varsFor(config, "development"), (vars) => vars["NAME"]?.origin);

describe("ConfigLoader", () => {
  it.effect("loads the default export of a config file", () =>
    Effect.gen(function* () {
      const loader = yield* ConfigLoader.ConfigLoader;
      const config = yield* loader.load(yield* fixture("valid", "envi.config.ts"));

      expect(Config.isConfig(config)).toBe(true);
      expect(yield* nameOf(config)).toMatchObject({ value: "valid" });
      expect(config.path).toEqual(Option.some(yield* fixture("valid", "envi.config.ts")));
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fails with NotFound, InvalidConfig, and ImportFailed", () =>
    Effect.gen(function* () {
      const loader = yield* ConfigLoader.ConfigLoader;
      const missing = yield* Effect.flip(loader.load(yield* fixture("nope", "envi.config.ts")));
      const invalid = yield* Effect.flip(loader.load(yield* fixture("invalid", "envi.config.ts")));
      const throwing = yield* Effect.flip(loader.load(yield* fixture("throws", "envi.config.ts")));

      const extension = yield* Effect.flip(
        loader.load(yield* fixture("valid", "nested", "deep", ".gitkeep")),
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

  describe("find", () => {
    it.effect("up finds the nearest config file of a directory", () =>
      Effect.gen(function* () {
        const loader = yield* ConfigLoader.ConfigLoader;
        const found = yield* loader.find(yield* fixture("valid", "nested", "deep"), Up);

        expect(found).toEqual([yield* fixture("valid", "envi.config.ts")]);
      }).pipe(Effect.provide(layer)),
    );

    it.effect("up stops at the project root, the nearest folder with .git", () =>
      Effect.gen(function* () {
        const root = yield* tree(["envi.config.ts", "repo/.git/", "repo/apps/api/"]);
        const error = yield* Effect.flip(find(root, "repo/apps/api", Up));

        expect(error.reason).toBe(ConfigLoadFailure.NoConfig);
        expect(yield* find(root, "repo", Up, root).pipe(Effect.flip)).toMatchObject({
          reason: ConfigLoadFailure.NoConfig,
        });
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("up stops at the home folder outside a repo", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const root = yield* tree(["envi.config.ts", "home/project/"]);
        const error = yield* Effect.flip(find(root, "home/project", Up, path.join(root, "home")));

        expect(error.reason).toBe(ConfigLoadFailure.NoConfig);
        expect(yield* find(root, "home/project", Up, path.join(root, "other"))).toEqual([
          "envi.config.ts",
        ]);
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("down finds one config per folder, without node_modules and dot folders", () =>
      Effect.gen(function* () {
        const root = yield* tree([
          "envi.config.ts",
          "a/envi.config.mts",
          "a/envi.config.ts",
          "b/c/envi.config.js",
          "node_modules/pkg/envi.config.ts",
          ".cache/envi.config.ts",
          "b/other.config.ts",
        ]);

        expect(yield* find(root, ".", Down)).toEqual([
          "a/envi.config.ts",
          "b/c/envi.config.js",
          "envi.config.ts",
        ]);
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("down in a repo lists the files of git, so an ignored config is left out", () =>
      Effect.gen(function* () {
        const root = yield* tree([
          ".gitignore",
          "apps/api/envi.config.ts",
          "apps/web/envi.config.ts",
          "apps/ignored/envi.config.ts",
          "envi.config.ts",
        ]);

        yield* gitInit(root);

        expect(yield* find(root, "apps", Down)).toEqual([
          "apps/api/envi.config.ts",
          "apps/web/envi.config.ts",
        ]);
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("repo searches down from the project root", () =>
      Effect.gen(function* () {
        const root = yield* tree([".gitignore", "apps/api/envi.config.ts", "envi.config.ts"]);

        yield* gitInit(root);

        expect(yield* find(root, "apps/api", Repo)).toEqual([
          "apps/api/envi.config.ts",
          "envi.config.ts",
        ]);
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("fails with NoConfig when a search down finds no config file", () =>
      Effect.gen(function* () {
        const root = yield* tree(["apps/api/"]);
        const error = yield* Effect.flip(find(root, ".", Down));

        expect(error.reason).toBe(ConfigLoadFailure.NoConfig);
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );
  });
});
