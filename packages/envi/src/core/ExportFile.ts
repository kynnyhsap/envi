import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";

import { ExportFileError, ExportFileFailure } from "./Errors.ts";

/** `git check-ignore` exits with this code for a path that git does not ignore. */
const notIgnoredExitCode = 1;

const fileMode = 0o600;

/**
 * Writes an export to a file with mode `0600`. It refuses a file that git does not ignore,
 * because a commit would publish the values. A directory outside a git repository passes, and so
 * does a machine without git.
 *
 * @param file - The target file. Its directory must exist.
 */
export const write = Effect.fn("ExportFile.write")(function* (file: string, text: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner;
  const absolute = path.resolve(file);
  const failure = (reason: ExportFileFailure) => new ExportFileError({ reason, path: absolute });

  const exitCode = yield* spawner
    .exitCode(
      ChildProcess.make("git", ["check-ignore", "--quiet", absolute], {
        cwd: path.dirname(absolute),
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      }),
    )
    .pipe(Effect.orElseSucceed(() => 0));

  if (exitCode === notIgnoredExitCode) {
    return yield* failure(ExportFileFailure.NotIgnored);
  }

  // The mode of `writeFileString` applies only to a new file.
  yield* fs.writeFileString(absolute, text, { mode: fileMode }).pipe(
    Effect.andThen(fs.chmod(absolute, fileMode)),
    Effect.mapError(() => failure(ExportFileFailure.WriteFailed)),
  );

  return absolute;
});
