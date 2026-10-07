import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { ExportFileError, ExportFileFailure } from "./Errors.ts";

const fileMode = 0o600;

/** The random bytes in the name of a temp file. */
const tempNameBytes = 6;

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
  const target = yield* fs.realPath(absolute).pipe(Effect.orElseSucceed(() => absolute));
  const suffix = Hex.encode(crypto.getRandomValues(new Uint8Array(tempNameBytes)));
  const temp = `${target}.${suffix}.tmp`;

  // `wx` creates a new file, so `mode` applies before the file holds a value.
  yield* Effect.acquireUseRelease(
    fs.writeFileString(temp, "", { flag: "wx", mode: fileMode }),
    () => fs.writeFileString(temp, text).pipe(Effect.andThen(fs.rename(temp, target))),
    () => Effect.ignore(fs.remove(temp, { force: true })),
  ).pipe(
    Effect.mapError(
      () => new ExportFileError({ reason: ExportFileFailure.WriteFailed, path: absolute }),
    ),
  );

  return absolute;
});
