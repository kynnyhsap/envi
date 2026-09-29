import { Argument, Command } from "effect/cli";
// Copies files and folders of the repo root into the package in the working directory. npm and
// `bun pm pack` run it as `prepack`, because a tarball holds only files of the package folder. A
// `=` names the target: `packages/docs/content=docs` copies the docs pages into `docs`. The script
// removes the old target first, so a deleted page leaves no copy. Git ignores the copies.
//
//   bun ../../scripts/prepack.ts LICENSE README.md packages/docs/content=docs skills
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { root, runCommand } from "./Workspace.ts";

const copies = Argument.String("copies").pipe(
  Argument.withDescription(
    "The files and folders of the repo root to copy, such as LICENSE, each with an optional target after =.",
  ),
  Argument.variadic({ min: 1 }),
);

const command = Command.make("prepack", { copies }, (input) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    yield* Effect.forEach(
      input.copies,
      (copy) => {
        const [source = copy, target = path.basename(source)] = copy.split("=");

        return Effect.andThen(
          fs.remove(target, { recursive: true, force: true }),
          fs.copy(path.join(root, source), target),
        );
      },
      { concurrency: "unbounded" },
    );
  }),
);

runCommand(command);
