// The shared parts of the workspace scripts: the repo root, the version, the error of a script,
// child processes, and the entry point. Bun runs each script, and each script uses this module.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command } from "effect/unstable/cli";
import { ChildProcess } from "effect/unstable/process";
import { fileURLToPath } from "node:url";

import rootManifest from "../package.json" with { type: "json" };

/** The root of the repo, with a trailing slash. */
export const root = fileURLToPath(new URL("..", import.meta.url));

/** The version of every package. The root manifest holds it. */
export const version = rootManifest.version;

/** A script failed. `detail` says what failed and what to do. */
export class ScriptError extends Schema.TaggedError<ScriptError>()("ScriptError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

/** The end of a child process: its exit code and its output. */
export interface Captured {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs a command to its end, and returns its exit code and its output. An exit code other than 0
 * is a result, not a failure. The variables of `env` extend the variables of this process, and an
 * `undefined` value removes one.
 */
export const capture = Effect.fn("capture")(function* (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string = root,
  env: Readonly<Record<string, string | undefined>> = {},
) {
  const handle = yield* ChildProcess.make(command, args, {
    cwd,
    env,
    extendEnv: true,
    stdin: "ignore",
  });

  const [exitCode, stdout, stderr] = yield* Effect.all(
    [
      handle.exitCode,
      Stream.mkString(Stream.decodeText(handle.stdout)),
      Stream.mkString(Stream.decodeText(handle.stderr)),
    ],
    { concurrency: "unbounded" },
  );

  const captured: Captured = { exitCode, stdout, stderr };

  return captured;
}, Effect.scoped);

/** Runs a command to its end, and returns its output. It fails when the command fails. */
export const output = Effect.fn("output")(function* (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string = root,
) {
  const result = yield* capture(command, args, cwd);

  return yield* result.exitCode === 0
    ? Effect.succeed(result.stdout)
    : Effect.fail(
        new ScriptError({
          detail: `${command} ${args.join(" ")} exited with ${result.exitCode}.\n${result.stderr}`,
        }),
      );
});

/** Runs a command with the output of this process. It fails when the command fails. */
export const exec = Effect.fn("exec")(function* (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string = root,
) {
  const handle = yield* ChildProcess.make(command, args, {
    cwd,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = yield* handle.exitCode;

  return yield* exitCode === 0
    ? Effect.void
    : Effect.fail(
        new ScriptError({ detail: `${command} ${args.join(" ")} exited with ${exitCode}.` }),
      );
}, Effect.scoped);

/** The files that git tracks and that match the pathspecs, relative to the root. */
export const trackedFiles = Effect.fn("trackedFiles")(function* (
  pathspecs: ReadonlyArray<string> = [],
) {
  const text = yield* output("git", ["ls-files", "-z", ...pathspecs]);

  return text.split("\0").filter((file) => file !== "");
});

/** Runs a script program with the Node services, and exits with its result. */
export const runScript = <E>(program: Effect.Effect<void, E, NodeServices.NodeServices>): void => {
  program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
};

/** Runs a script command with the Node services and the workspace version. */
export const runCommand = <Name extends string, Input, ContextInput, E>(
  command: Command.Command<Name, Input, ContextInput, E, NodeServices.NodeServices>,
): void => {
  runScript(Command.run(command, { version }));
};
