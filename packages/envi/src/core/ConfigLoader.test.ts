import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ConfigLoader from "./ConfigLoader.ts";
import { ConfigLoadFailure } from "./Errors.ts";
import { nodePlatform, withEnv } from "./fixtures/Support.ts";

const layer = Layer.provideMerge(
  ConfigLoader.layer,
  Layer.provideMerge(NodeChildProcessSpawner.layer, nodePlatform),
);

const { Down, Up } = ConfigLoader.ConfigSearch;

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

/** Runs a search with the given HOME, and returns the paths relative to the root. */
const find = (root: string, from: string, search: ConfigLoader.ConfigSearch, home = "/nowhere") =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const loader = yield* ConfigLoader.ConfigLoader;

    const found = yield* loader.find(path.join(root, from), search).pipe(withEnv({ HOME: home }));

    return found.map((file) => path.relative(root, file));
  });

const fixture = (...segments: ReadonlyArray<string>) =>
  Effect.map(Path.Path, (path) =>
    path.join(import.meta.dirname, "fixtures", "loader", ...segments),
  );

describe("ConfigLoader", () => {
  it.effect("fails with ImportFailed for a config that throws, and hides the message", () =>
    Effect.gen(function* () {
      const loader = yield* ConfigLoader.ConfigLoader;
      const error = yield* Effect.flip(loader.load(yield* fixture("throws", "envi.config.ts")));

      expect(error.reason).toBe(ConfigLoadFailure.ImportFailed);
      expect(error.message).not.toContain("secret-in-config-error");
    }).pipe(Effect.provide(layer)),
  );

  describe("find", () => {
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

    it.effect("fails with NoConfig when a search down finds no config file", () =>
      Effect.gen(function* () {
        const root = yield* tree(["apps/api/"]);
        const error = yield* Effect.flip(find(root, ".", Down));

        expect(error.reason).toBe(ConfigLoadFailure.NoConfig);
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );
  });
});
