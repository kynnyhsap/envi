import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as Package from "./core/Package.ts";
import { findLocalBin } from "./delegate.ts";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

/**
 * A project with a local installation of Envi under the name from its manifest, which can hold a
 * scope, and a directory below the project.
 */
const makeProject = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "envi-delegate-" }));
  const packageDirectory = path.join(root, "node_modules", ...Package.name.split("/"));
  const bin = path.join(packageDirectory, "dist", "bin.js");
  const nested = path.join(root, "apps", "web");

  yield* fs.makeDirectory(path.dirname(bin), { recursive: true });
  yield* fs.makeDirectory(nested, { recursive: true });
  yield* fs.writeFileString(bin, "");

  yield* fs.writeFileString(
    path.join(packageDirectory, "package.json"),
    JSON.stringify({ name: Package.name, bin: { envi: "./dist/bin.js" } }),
  );

  return { root, bin, nested };
});

describe("findLocalBin", () => {
  it.effect("finds the local installation from a directory below the project", () =>
    Effect.gen(function* () {
      const project = yield* makeProject;
      const found = yield* findLocalBin(project.nested, "/usr/local/lib/envi/dist/bin.js");

      expect(found).toEqual(Option.some(project.bin));
    }).pipe(Effect.provide(platform)),
  );

  it.effect("finds nothing when the running file is the local installation", () =>
    Effect.gen(function* () {
      const project = yield* makeProject;

      expect(yield* findLocalBin(project.nested, project.bin)).toEqual(Option.none());
    }).pipe(Effect.provide(platform)),
  );

  it.effect("finds nothing without a local installation", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const empty = yield* fs.makeTempDirectoryScoped({ prefix: "envi-delegate-empty-" });

      expect(yield* findLocalBin(empty, "/usr/local/lib/envi/dist/bin.js")).toEqual(Option.none());
    }).pipe(Effect.provide(platform)),
  );
});
