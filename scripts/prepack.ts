// Copies files of the repo root into the package in the working directory. npm and `bun publish`
// run it as `prepack`, because a tarball holds a README and a LICENSE only from the package
// folder. Git ignores the copies.
//
//   bun ../../scripts/prepack.ts LICENSE README.md
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { Argument, Command } from "effect/unstable/cli";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

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

Command.run(command, { version: "0.0.0" }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
