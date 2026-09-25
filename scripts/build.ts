// Builds the package in the working directory. Each package runs it with Bun through
// `bun run build`: poof removes `dist`, then tsc compiles `src` into a new `dist`.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { ChildProcess } from "effect/unstable/process";
import { fileURLToPath } from "node:url";

/** The binaries of the workspace, so the script runs without `bun run` on the `PATH`. */
const binaries = fileURLToPath(new URL("../node_modules/.bin/", import.meta.url));

class BuildError extends Data.TaggedError("BuildError")<{ readonly detail: string }> {
  override get message(): string {
    return `The build failed: ${this.detail}`;
  }
}

/** Runs a binary of the workspace with the output of this process, and fails on an exit code. */
const exec = (name: string, args: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(`${binaries}${name}`, args, {
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
      });

      const exitCode = yield* handle.exitCode;

      return yield* exitCode === 0
        ? Effect.void
        : Effect.fail(new BuildError({ detail: `${name} exited with ${exitCode}.` }));
    }),
  );

const build = Effect.gen(function* () {
  yield* exec("poof", ["dist"]);
  yield* exec("tsc", ["-p", "tsconfig.build.json"]);
});

build.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
