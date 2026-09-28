import { Argument, Command } from "effect/cli";
// Copies files of the repo root into the package in the working directory. npm and `bun pm pack`
// run it as `prepack`, because a tarball holds a README and a LICENSE only from the package
// folder. Git ignores the copies.
//
//   bun ../../scripts/prepack.ts LICENSE README.md
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { root, runCommand } from "./Workspace.ts";

const files = Argument.String("files").pipe(
  Argument.withDescription("The files of the repo root to copy, such as LICENSE."),
  Argument.variadic({ min: 1 }),
);

const command = Command.make("prepack", { files }, (input) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    yield* Effect.forEach(input.files, (file) => fs.copyFile(path.join(root, file), file), {
      concurrency: "unbounded",
    });
  }),
);

runCommand(command);
