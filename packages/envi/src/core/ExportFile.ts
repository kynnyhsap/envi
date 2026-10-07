import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { ExportFileError, ExportFileFailure } from "./Errors.ts";

const fileMode = 0o600;

/** The random bytes in the name of a temp file. */
const tempNameBytes = 6;

/** The most links that Envi follows from the output path, as `SYMLOOP_MAX` of POSIX does. */
const maxLinks = 40;

/**
 * The file that a write to `file` changes. `realPath` resolves an existing file. A dangling link
 * fails `realPath`, so Envi follows its chain with `readLink` to the missing file. A path that is
 * no link names itself. A loop of links fails.
 */
const targetOf = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  file: string,
  links = 0,
): Effect.Effect<string, unknown> =>
  fs.realPath(file).pipe(
    Effect.catch(() =>
      fs.readLink(file).pipe(
        Effect.matchEffect({
          onFailure: () => Effect.succeed(file),
          onSuccess: (pointer) =>
            links < maxLinks
              ? targetOf(fs, path, path.resolve(path.dirname(file), pointer), links + 1)
              : Effect.fail(file),
        }),
      ),
    ),
  );

/**
 * Writes an export to a file with mode `0600`. The user names the file, so the user decides
 * where the values go. Envi writes a new private temp file next to the target and renames it, so
 * the values never sit in a file with a wider mode, and a failed write keeps the old file. For a
 * symlink, Envi replaces the file that the link points to and keeps the link.
 *
 * @param file - The target file. Its directory must exist.
 */
export const write = Effect.fn("ExportFile.write")(function* (file: string, text: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = path.resolve(file);

  const failed = () =>
    new ExportFileError({ reason: ExportFileFailure.WriteFailed, path: absolute });

  const target = yield* Effect.mapError(targetOf(fs, path, absolute), failed);
  const suffix = Hex.encode(crypto.getRandomValues(new Uint8Array(tempNameBytes)));
  const temp = `${target}.${suffix}.tmp`;

  // `wx` creates a new file. The umask can narrow its mode, so `chmod` sets `0600` before the
  // file holds a value.
  yield* Effect.acquireUseRelease(
    fs.writeFileString(temp, "", { flag: "wx", mode: fileMode }),
    () =>
      fs
        .chmod(temp, fileMode)
        .pipe(
          Effect.andThen(fs.writeFileString(temp, text)),
          Effect.andThen(fs.rename(temp, target)),
        ),
    () => Effect.ignore(fs.remove(temp, { force: true })),
  ).pipe(Effect.mapError(failed));

  return absolute;
});
