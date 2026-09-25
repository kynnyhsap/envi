import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { ExportFileError, ExportFileFailure } from "./Errors.ts";

const fileMode = 0o600;

/**
 * Writes an export to a file with mode `0600`. The user names the file, so the user decides
 * where the values go.
 *
 * @param file - The target file. Its directory must exist.
 */
export const write = Effect.fn("ExportFile.write")(function* (file: string, text: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = path.resolve(file);

  // The mode of `writeFileString` applies only to a new file.
  yield* fs.writeFileString(absolute, text, { mode: fileMode }).pipe(
    Effect.andThen(fs.chmod(absolute, fileMode)),
    Effect.mapError(
      () => new ExportFileError({ reason: ExportFileFailure.WriteFailed, path: absolute }),
    ),
  );

  return absolute;
});
