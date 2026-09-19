// A global `envi` starts the local `envi` of the project. The config file imports the local
// packages, and the CLI must use the same copy of `effect` as the config file. Two copies of
// `effect` in one process break `Schema` decoding and `Redacted`.
import { Signals } from "@envi/core";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/unstable/process/ChildProcess";

/** The variable that marks a delegated run. It prevents a loop. */
export const delegatedVariable = "ENVI_DELEGATED";

const packageName = "envi";

const Manifest = Schema.fromJsonString(
  Schema.Struct({ bin: Schema.Struct({ envi: Schema.String }) }),
);

/**
 * The entry file of the nearest local installation, from `directory` upward.
 *
 * @param currentFile - The entry file of the running CLI.
 * @returns Nothing when no local installation exists, or when it is the running CLI.
 */
export const findLocalBin = Effect.fn("delegate.findLocalBin")(function* (
  directory: string,
  currentFile: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const realPath = (file: string) => Effect.orElseSucceed(fs.realPath(file), () => file);
  const current = yield* realPath(currentFile);

  const binIn = (candidate: string) => {
    const packageDirectory = path.join(candidate, "node_modules", packageName);

    return fs.readFileString(path.join(packageDirectory, "package.json")).pipe(
      Effect.flatMap(Schema.decodeEffect(Manifest)),
      Effect.flatMap((manifest) =>
        Effect.all({
          bin: fs.realPath(path.join(packageDirectory, manifest.bin.envi)),
          directory: fs.realPath(packageDirectory),
        }),
      ),
      Effect.option,
    );
  };

  let candidate = path.resolve(directory);

  while (true) {
    const found = yield* binIn(candidate);

    if (Option.isSome(found)) {
      // The running CLI is the local installation when its file sits inside that package. This
      // also covers a run from the sources of the package.
      return Option.map(
        Option.filter(found, (local) => !current.startsWith(`${local.directory}${path.sep}`)),
        (local) => local.bin,
      );
    }

    const parent = path.dirname(candidate);

    if (parent === candidate) {
      return Option.none<string>();
    }

    candidate = parent;
  }
});

/**
 * Runs the local CLI with the same arguments and the same runtime.
 *
 * @param runtime - The executable of the running runtime, such as the path of `node` or `bun`.
 * @returns The exit code of the local CLI.
 */
export const runLocal = (runtime: string, bin: string, argv: ReadonlyArray<string>) =>
  Effect.map(
    Signals.supervise(
      ChildProcess.make(runtime, [bin, ...argv], {
        env: { [delegatedVariable]: "1" },
        extendEnv: true,
        detached: false,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }),
    ),
    Option.getOrElse(() => 1),
  );
