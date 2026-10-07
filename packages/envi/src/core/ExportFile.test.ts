// A named bug: `export --output` wrote the values into an existing file first and tightened its
// mode after, so a world-readable file held the secrets for a moment, and a failed write left a
// truncated file. A fake file system keeps the POSIX rules that matter here: a write truncates
// the file first, and its mode applies only to a new file.
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { ExportFileError, ExportFileFailure } from "./Errors.ts";
import * as ExportFile from "./ExportFile.ts";

interface FakeFile {
  readonly text: string;
  readonly mode: number;
}

const privateMode = 0o600;

const readableMode = 0o644;

const secret = "fake-secret-sentinel";

const destination = "/project/.env.production";

const oldFile: FakeFile = { text: "API_TOKEN=old-token\n", mode: readableMode };

const exported = `API_TOKEN=${secret}\n`;

const systemError = (tag: PlatformError.SystemErrorTag, method: string, path: string) =>
  PlatformError.systemError({ _tag: tag, module: "FileSystem", method, pathOrDescriptor: path });

/**
 * A disk in memory. `exposures` lists each path that held the secret under a mode other than
 * `0600`. With `failWrites`, a write of text truncates the file and then fails, as a full disk
 * does.
 */
const makeDisk = (initial: Readonly<Record<string, FakeFile>>, failWrites = false) => {
  const files = new Map(Object.entries(initial));
  const exposures: Array<string> = [];

  const store = (path: string, file: FakeFile) => {
    files.set(path, file);

    if (file.text.includes(secret) && file.mode !== privateMode) {
      exposures.push(path);
    }
  };

  const fileSystem = FileSystem.makeNoop({
    realPath: (path) =>
      files.has(path)
        ? Effect.succeed(path)
        : Effect.fail(systemError("NotFound", "realPath", path)),
    writeFileString: (path, data, options) =>
      Effect.suspend(() => {
        const existing = files.get(path);

        if (existing !== undefined && options?.flag === "wx") {
          return Effect.fail(systemError("AlreadyExists", "writeFileString", path));
        }

        const mode = existing?.mode ?? options?.mode ?? readableMode;
        store(path, { text: "", mode });

        if (failWrites && data !== "") {
          return Effect.fail(systemError("WriteZero", "writeFileString", path));
        }

        store(path, { text: data, mode });

        return Effect.void;
      }),
    chmod: (path, mode) =>
      Effect.sync(() => {
        const file = files.get(path);

        if (file !== undefined) {
          store(path, { ...file, mode });
        }
      }),
    rename: (from, to) =>
      Effect.suspend(() => {
        const file = files.get(from);

        if (file === undefined) {
          return Effect.fail(systemError("NotFound", "rename", from));
        }

        files.delete(from);
        store(to, file);

        return Effect.void;
      }),
    remove: (path) => Effect.sync(() => void files.delete(path)),
  });

  return { files, exposures, fileSystem };
};

const writeOn = (disk: ReturnType<typeof makeDisk>) =>
  ExportFile.write(destination, exported).pipe(
    Effect.provideService(FileSystem.FileSystem, disk.fileSystem),
    Effect.provide(Path.layer),
  );

describe("export to a file", () => {
  it.effect("never puts the values into a readable file, and replaces it with a private one", () =>
    Effect.gen(function* () {
      const disk = makeDisk({ [destination]: oldFile });

      yield* writeOn(disk);

      expect(disk.exposures).toEqual([]);
      expect([...disk.files]).toEqual([[destination, { text: exported, mode: privateMode }]]);
    }),
  );

  it.effect("keeps the old file and leaves no other file when the write fails", () =>
    Effect.gen(function* () {
      const disk = makeDisk({ [destination]: oldFile }, true);

      const error = yield* Effect.flip(writeOn(disk));

      expect(error).toBeInstanceOf(ExportFileError);
      expect(error.reason).toBe(ExportFileFailure.WriteFailed);
      expect([...disk.files]).toEqual([[destination, oldFile]]);

      const working = makeDisk({ [destination]: oldFile });

      yield* writeOn(working);

      expect(working.files.get(destination)).toEqual({ text: exported, mode: privateMode });
    }),
  );
});
