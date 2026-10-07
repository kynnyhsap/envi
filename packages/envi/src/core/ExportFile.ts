import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { ExportFileError, ExportFileFailure } from "./Errors.ts";

const fileMode = 0o600;

/** The random bytes in the name of a temp file. */
const tempNameBytes = 6;

/** The most links that Envi follows from the output path, as `SYMLOOP_MAX` of POSIX does. */
const maxLinks = 40;

/**
 * A path that the OS resolves part by part. `path.resolve` removes `alias/..` before the OS
 * follows the link `alias`, so it can name another file.
 */
const joinRaw = (path: Path.Path, folder: string, file: string): string =>
  path.isAbsolute(file) ? file : `${folder}${path.sep}${file}`;

/**
 * The file that a write to `file` changes. Envi follows a chain of links with `readLink`, also to
 * a missing file. It never normalizes a path, because `realPath` and `path.resolve` remove
 * `alias/..` before the OS follows the link `alias`. A path that is no link names itself. A loop
 * of links fails.
 */
const targetOf = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  file: string,
  links = 0,
): Effect.Effect<string, string> =>
  fs.readLink(file).pipe(
    Effect.matchEffect({
      onFailure: () => Effect.succeed(file),
      onSuccess: (pointer) =>
        links < maxLinks
          ? targetOf(fs, path, joinRaw(path, path.dirname(file), pointer), links + 1)
          : Effect.fail(file),
    }),
  );

/**
 * Writes an export to a file with mode `0600`. The user names the file, so the user decides
 * where the values go. Envi creates a new private temp file next to the target, writes the
 * values through the handle of that file, and renames it. So the values never sit in a file with
 * a wider mode, a file that another user puts at the temp path never gets them, and a failed write
 * keeps the old file. For a symlink, Envi replaces the file that the link points to and keeps the
 * link.
 *
 * @param file - The target file. Its directory must exist.
 */
export const write = Effect.fn("ExportFile.write")(function* (file: string, text: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = path.resolve(file);

  const failed = () =>
    new ExportFileError({ reason: ExportFileFailure.WriteFailed, path: absolute });

  const target = yield* Effect.mapError(
    targetOf(fs, path, joinRaw(path, path.resolve("."), file)),
    failed,
  );

  const suffix = Hex.encode(crypto.getRandomValues(new Uint8Array(tempNameBytes)));
  // A short name, because the name of the target can have the longest length that the OS allows.
  const temp = `${path.dirname(target)}${path.sep}.envi-${suffix}.tmp`;

  // `wx` creates a new file, and the handle keeps that file when another process changes the
  // path. The umask can narrow the mode of the new file, so `chmod` sets `0600` before the rename.
  yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* Effect.acquireRelease(
        fs.open(temp, { flag: "wx", mode: fileMode }),
        (_, exit) =>
          Exit.isSuccess(exit) ? Effect.void : Effect.ignore(fs.remove(temp, { force: true })),
      );

      yield* handle.writeAll(new TextEncoder().encode(text));
      yield* fs.chmod(temp, fileMode);
      yield* fs.rename(temp, target);
    }),
  ).pipe(Effect.mapError(failed));

  yield* Effect.logDebug("Envi wrote the export to a file.").pipe(
    Effect.annotateLogs({ file: absolute }),
  );

  return absolute;
});
