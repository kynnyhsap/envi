import { Command, Flag } from "effect/cli";
// Renames the npm packages of the workspace to the names in `scripts/packages.ts`. It reads the
// current name of each package from its manifest, replaces each old name with the new name in
// every tracked text file, and runs `bun install` to update the lockfile.
//
//   bun run rename           renames every package whose manifest differs
//   bun run rename --check   fails when a manifest differs, without a change
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { packageNames } from "./packages.ts";
import { exec, root, runCommand, ScriptError, trackedFiles } from "./Workspace.ts";

const Manifest = Schema.fromJsonString(Schema.Struct({ name: Schema.String }));

/** The files that can hold a package name. Bun rewrites `bun.lock` itself. */
const textFile = /\.(?:ts|mts|js|mjs|json|md|ya?ml)$/u;

interface Rename {
  readonly from: string;
  readonly to: string;
}

const escape = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\/]/gu, "\\$&");

/**
 * Replaces every old name in one pass, so one rename never feeds the next. A whole name matches:
 * `@scope/envi` matches in `@scope/envi/testing`, never in `@scope/envi-1password`.
 */
const renameText = (text: string, renames: ReadonlyArray<Rename>): string => {
  const targets = new Map(renames.map((rename) => [rename.from, rename.to]));
  const names = renames.map((rename) => escape(rename.from)).join("|");

  return text.replaceAll(
    new RegExp(`(?<![\\w@/.-])(?:${names})(?![\\w-])`, "gu"),
    (name) => targets.get(name) ?? name,
  );
};

/** The tracked text files that can hold a package name. */
const textFiles = Effect.map(trackedFiles(), (files) =>
  files.filter((file) => textFile.test(file)),
);

/** The packages whose manifest name differs from `scripts/packages.ts`. */
const pendingRenames = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const renames = yield* Effect.forEach(Object.entries(packageNames), ([folder, to]) =>
    fs.readFileString(path.join(root, folder, "package.json")).pipe(
      Effect.flatMap(Schema.decodeEffect(Manifest)),
      Effect.map((manifest): Rename => ({ from: manifest.name, to })),
    ),
  );

  return renames.filter((rename) => rename.from !== rename.to);
});

const listOf = (renames: ReadonlyArray<Rename>): string =>
  renames.map((rename) => `${rename.from} -> ${rename.to}`).join(", ");

const check = Flag.Boolean("check").pipe(
  Flag.withDescription("Fail when a manifest differs from scripts/packages.ts."),
  Flag.withDefault(false),
);

const command = Command.make("rename", { check }, (input) =>
  Effect.gen(function* () {
    const renames = yield* pendingRenames;

    if (renames.length === 0) {
      return yield* Console.log("The package names match scripts/packages.ts.");
    }

    if (input.check) {
      return yield* new ScriptError({
        detail: `The manifests differ from scripts/packages.ts: ${listOf(renames)}. Run \`bun run rename\`.`,
      });
    }

    // A name without a scope, such as `envi`, also matches the command and other words.
    const bare = renames.find((rename) => !rename.from.includes("/"));

    if (bare !== undefined) {
      return yield* new ScriptError({
        detail: `The old name ${bare.from} has no scope, so it matches other words too. Rename it by hand.`,
      });
    }

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files = yield* textFiles;

    const changed = yield* Effect.forEach(files, (file) =>
      Effect.gen(function* () {
        const absolute = path.join(root, file);
        const text = yield* fs.readFileString(absolute);
        const renamed = renameText(text, renames);

        if (renamed === text) {
          return false;
        }

        yield* fs.writeFileString(absolute, renamed);

        return true;
      }),
    );

    yield* exec(process.execPath, ["install"]);

    return yield* Console.log(
      `Renamed ${listOf(renames)} in ${changed.filter(Boolean).length} files.`,
    );
  }),
);

runCommand(command);
