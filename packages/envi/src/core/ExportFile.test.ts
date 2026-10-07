// Named bugs of `export --output`:
// - It wrote the values into an existing file first and tightened its mode after, so a
//   world-readable file held the secrets for a moment, and a failed write left a truncated file.
// - It wrote the values into the temp file by its path. Another user who can write the folder
//   can replace the temp file with a link to a readable file between two calls.
// A fake disk keeps the POSIX rules that matter here: a write by path truncates the file first and
// follows a link, its mode applies only to a new file, and an open handle keeps its file when the
// path changes.
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { ExportFileError, ExportFileFailure } from "./Errors.ts";
import * as ExportFile from "./ExportFile.ts";

/** A file on the fake disk. A handle and a path share it, so a write through either changes it. */
interface FakeFile {
  text: string;
  mode: number;
}

interface FakeLink {
  readonly link: string;
}

type Entry = FakeFile | FakeLink;

const privateMode = 0o600;

const readableMode = 0o644;

const secret = "fake-secret-sentinel";

const destination = "/project/.env.production";

/** A readable file that the attacker points the temp path at. */
const publicFile = "/project/public.txt";

const publicText = "public\n";

const oldText = "API_TOKEN=old-token\n";

const exported = `API_TOKEN=${secret}\n`;

const decoder = new TextDecoder();

const isLink = (entry: Entry | undefined): entry is FakeLink =>
  entry !== undefined && "link" in entry;

const systemError = (tag: PlatformError.SystemErrorTag, method: string, path: string) =>
  PlatformError.systemError({ _tag: tag, module: "FileSystem", method, pathOrDescriptor: path });

interface DiskOptions {
  /** A write of text truncates the file and then fails, as a full disk does. */
  readonly failWrites?: boolean;
  /** Another user replaces the temp file with a link at the first call on its path. */
  readonly attack?: boolean;
}

/**
 * A disk in memory with the destination and a readable public file. `exposures` counts each
 * write of the secret into a file with a mode other than `0600`, or into the public file.
 */
const makeDisk = (options: DiskOptions = {}) => {
  const entries = new Map<string, Entry>([
    [destination, { text: oldText, mode: readableMode }],
    [publicFile, { text: publicText, mode: readableMode }],
  ]);

  const exposures: Array<string> = [];
  let attacked = false;

  const fileAt = (path: string): FakeFile | undefined => {
    const entry = entries.get(path);

    return isLink(entry) ? fileAt(entry.link) : entry;
  };

  const write = (file: FakeFile, data: string, path: string) =>
    Effect.suspend(() => {
      if (options.failWrites === true && data !== "") {
        return Effect.fail(systemError("WriteZero", "write", path));
      }

      file.text += data;

      if (
        file.text.includes(secret) &&
        (file.mode !== privateMode || file === fileAt(publicFile))
      ) {
        exposures.push(path);
      }

      return Effect.void;
    });

  /** The attacker acts once, at the first call on the path of a temp file that exists. */
  const attackAt = (path: string) => {
    if (options.attack === true && !attacked && path.endsWith(".tmp") && entries.has(path)) {
      attacked = true;
      entries.set(path, { link: publicFile });
    }
  };

  const open = (path: string, mode: number) => {
    const file: FakeFile = { text: "", mode };
    entries.set(path, file);

    const handle: FileSystem.File = {
      [FileSystem.FileTypeId]: FileSystem.FileTypeId,
      stat: Effect.die("unused"),
      seek: () => Effect.die("unused"),
      sync: Effect.void,
      read: () => Effect.die("unused"),
      readAlloc: () => Effect.die("unused"),
      truncate: () => Effect.die("unused"),
      write: () => Effect.die("unused"),
      writeAll: (bytes) => write(file, decoder.decode(bytes), path),
    };

    return handle;
  };

  const fileSystem = FileSystem.makeNoop({
    readLink: (path) =>
      Effect.suspend(() => {
        const entry = entries.get(path);

        return isLink(entry)
          ? Effect.succeed(entry.link)
          : Effect.fail(systemError("InvalidData", "readLink", path));
      }),
    open: (path, openOptions) =>
      Effect.suspend(() =>
        entries.has(path) && openOptions?.flag === "wx"
          ? Effect.fail(systemError("AlreadyExists", "open", path))
          : Effect.succeed(open(path, openOptions?.mode ?? readableMode)),
      ),
    writeFileString: (path, data, writeOptions) =>
      Effect.suspend(() => {
        attackAt(path);

        if (entries.has(path) && writeOptions?.flag === "wx") {
          return Effect.fail(systemError("AlreadyExists", "writeFileString", path));
        }

        const existing = fileAt(path);
        const file = existing ?? { text: "", mode: writeOptions?.mode ?? readableMode };

        file.text = "";

        if (existing === undefined) {
          entries.set(path, file);
        }

        return write(file, data, path);
      }),
    chmod: (path, mode) =>
      Effect.sync(() => {
        attackAt(path);

        const file = fileAt(path);

        if (file !== undefined) {
          file.mode = mode;
        }
      }),
    rename: (from, to) =>
      Effect.suspend(() => {
        attackAt(from);

        const entry = entries.get(from);

        if (entry === undefined) {
          return Effect.fail(systemError("NotFound", "rename", from));
        }

        entries.delete(from);
        entries.set(to, entry);

        return Effect.void;
      }),
    remove: (path) => Effect.sync(() => void entries.delete(path)),
  });

  const textAt = (path: string) => Option.fromUndefinedOr(fileAt(path)?.text);

  return { entries, exposures, fileSystem, textAt, fileAt };
};

const writeOn = (disk: ReturnType<typeof makeDisk>) =>
  ExportFile.write(destination, exported).pipe(
    Effect.provideService(FileSystem.FileSystem, disk.fileSystem),
    Effect.provide(Path.layer),
  );

describe("export to a file", () => {
  it.effect("never puts the values into a readable file, and replaces it with a private one", () =>
    Effect.gen(function* () {
      const disk = makeDisk();

      yield* writeOn(disk);

      expect(disk.exposures).toEqual([]);
      expect(disk.fileAt(destination)).toEqual({ text: exported, mode: privateMode });
      expect([...disk.entries.keys()].toSorted()).toEqual([destination, publicFile].toSorted());
    }),
  );

  it.effect("keeps the old file and leaves no other file when the write fails", () =>
    Effect.gen(function* () {
      const disk = makeDisk({ failWrites: true });

      const error = yield* Effect.flip(writeOn(disk));

      expect(error).toBeInstanceOf(ExportFileError);
      expect(error.reason).toBe(ExportFileFailure.WriteFailed);
      expect(disk.fileAt(destination)).toEqual({ text: oldText, mode: readableMode });
      expect([...disk.entries.keys()].toSorted()).toEqual([destination, publicFile].toSorted());

      const working = makeDisk();

      yield* writeOn(working);

      expect(working.fileAt(destination)).toEqual({ text: exported, mode: privateMode });
    }),
  );

  it.effect("never writes the values into a file that another user puts at the temp path", () =>
    Effect.gen(function* () {
      const disk = makeDisk({ attack: true });

      yield* Effect.ignore(writeOn(disk));

      expect(disk.exposures).toEqual([]);
      expect(disk.textAt(publicFile)).toEqual(Option.some(publicText));

      const working = makeDisk();

      yield* writeOn(working);

      expect(working.textAt(destination)).toEqual(Option.some(exported));
    }),
  );
});
