// The file cache: one file for each entry, in a directory with the mode `0700`. `CacheEntry` holds
// the file format and the encryption, and `CacheLock` holds the resolve lock.
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import type * as Redacted from "effect/Redacted";

import * as Cache from "./Cache.ts";
import * as CacheEntry from "./CacheEntry.ts";
import * as CacheLock from "./CacheLock.ts";
import * as Digest from "./Digest.ts";
import { CacheError, CacheFailure } from "./Errors.ts";

/** The settings of the file cache. */
export interface Options {
  readonly directory: string;
  /** The longest wait for the resolve lock. Default: 2 minutes. */
  readonly lockWait?: Duration.Input;
  /** The age at which a lock counts as the lock of a crashed owner. Default: 30 seconds. */
  readonly lockStaleAfter?: Duration.Input;
}

/** The 32 bytes of the AES key. The Keychain layer reads them from the macOS Keychain. */
export class EncryptionKey extends Context.Service<
  EncryptionKey,
  Effect.Effect<Redacted.Redacted<Uint8Array>, CacheError>
>()("envi/FileCache/EncryptionKey") {}

/** A fixed key. Tests use it, and a custom key store can use it. */
export const layerEncryptionKey = (
  key: Redacted.Redacted<Uint8Array>,
): Layer.Layer<EncryptionKey> => Layer.succeed(EncryptionKey, Effect.succeed(key));

const defaultLockWait = Duration.minutes(2);

const defaultLockStaleAfter = Duration.seconds(30);

const entrySuffix = ".json";

/** The suffix of an entry that Envi writes and has not renamed yet. `clear` removes it. */
const tempSuffix = ".tmp";

/** The random bytes in the name of a temp file. */
const tempNameBytes = 6;

const directoryMode = 0o700;

const fileMode = 0o600;

const unreadable = (detail: string): CacheError =>
  new CacheError({ reason: CacheFailure.Unreadable, detail });

const unwritable = (detail: string): CacheError =>
  new CacheError({ reason: CacheFailure.Unwritable, detail });

const fileNameOf = (key: string): Effect.Effect<string> =>
  Effect.map(Digest.sha256Hex(key), (digest) => `${digest}${entrySuffix}`);

const make = Effect.fn("FileCache.make")(function* (
  options: Options,
  encryptionKey: Option.Option<Effect.Effect<Redacted.Redacted<Uint8Array>, CacheError>>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const lock = yield* CacheLock.make({
    directory: options.directory,
    wait: options.lockWait ?? defaultLockWait,
    staleAfter: Option.getOrElse(
      Option.flatMap(Option.fromUndefinedOr(options.lockStaleAfter), Duration.fromInput),
      () => defaultLockStaleAfter,
    ),
  });

  // The key and the 1Password client are both slow. Envi reads the key on the first use only.
  const keyring: CacheEntry.Keyring = Option.isNone(encryptionKey)
    ? Option.none()
    : Option.some(yield* Effect.cached(Effect.flatMap(encryptionKey.value, CacheEntry.importKey)));

  const ensureDirectory = fs
    .makeDirectory(options.directory, { recursive: true, mode: directoryMode })
    .pipe(Effect.mapError(() => unwritable("Envi cannot create the cache directory.")));

  const readEntry = (file: string): Effect.Effect<Option.Option<CacheEntry.Entry>> =>
    fs.readFileString(file).pipe(
      Effect.flatMap(CacheEntry.parse),
      Effect.orElseSucceed(() => Option.none()),
    );

  /** A missing, a corrupt, a moved, and an edited entry are all absent. */
  const readRecord = (key: string): Effect.Effect<Option.Option<Cache.CacheRecord>, CacheError> =>
    Effect.gen(function* () {
      const file = path.join(options.directory, yield* fileNameOf(key));
      const found = Option.filter(yield* readEntry(file), (entry) => entry.key === key);

      return Option.isNone(found)
        ? Option.none()
        : yield* CacheEntry.toRecord(found.value, keyring);
    });

  /**
   * Writes a temp file and renames it, so a reader never sees a partial entry. The release
   * removes the temp file also after an interrupt, because a plaintext entry holds a secret.
   */
  const writeRecord = (key: string, record: Cache.CacheRecord): Effect.Effect<void, CacheError> =>
    Effect.gen(function* () {
      const file = path.join(options.directory, yield* fileNameOf(key));
      const suffix = Hex.encode(crypto.getRandomValues(new Uint8Array(tempNameBytes)));
      const temp = `${file}.${suffix}${tempSuffix}`;
      const text = yield* CacheEntry.encode(key, record, keyring);

      yield* Effect.acquireUseRelease(
        Effect.as(fs.writeFileString(temp, text, { flag: "wx", mode: fileMode }), temp),
        () => fs.rename(temp, file),
        () => Effect.ignore(fs.remove(temp, { force: true })),
      ).pipe(Effect.mapError(() => unwritable("Envi cannot write a cache entry.")));
    });

  /** The files of the cache directory whose names end with the suffix. */
  const filesEndingWith = (suffix: string) =>
    fs.readDirectory(options.directory).pipe(
      Effect.map((names) =>
        names
          .filter((name) => name.endsWith(suffix))
          .map((name) => path.join(options.directory, name)),
      ),
      Effect.catchIf(
        (error) => Predicate.isTagged(error.reason, "NotFound"),
        () => Effect.succeed([]),
      ),
      Effect.mapError(() => unreadable("Envi cannot read the cache directory.")),
    );

  const entryFiles = filesEndingWith(entrySuffix);

  const tempFiles = filesEndingWith(tempSuffix);

  const remove = (file: string) =>
    fs
      .remove(file, { force: true })
      .pipe(Effect.mapError(() => unwritable("Envi cannot remove a cache entry.")));

  return Cache.Cache.of({
    getMany: (keys) =>
      Effect.map(
        Effect.forEach(
          keys,
          (key) => Effect.map(readRecord(key), (found) => [key, found] as const),
          {
            concurrency: "unbounded",
          },
        ),
        (entries) =>
          Object.fromEntries(
            entries.flatMap(([key, found]) =>
              Option.toArray(Option.map(found, (record) => [key, record])),
            ),
          ),
      ),
    setMany: (records) =>
      Effect.andThen(
        ensureDirectory,
        Effect.forEach(Object.entries(records), ([key, record]) => writeRecord(key, record), {
          concurrency: "unbounded",
          discard: true,
        }),
      ),
    list: () =>
      Effect.flatMap(entryFiles, (files) =>
        Effect.map(Effect.forEach(files, readEntry, { concurrency: "unbounded" }), (entries) =>
          entries.flatMap(Option.toArray).map((entry) => ({
            key: entry.key,
            provider: entry.provider,
            reference: entry.reference,
            resolvedAt: entry.resolvedAt,
          })),
        ),
      ),
    clear: () =>
      Effect.flatMap(Effect.all([entryFiles, tempFiles]), ([entries, temps]) =>
        Effect.as(
          Effect.forEach([...entries, ...temps], remove, {
            concurrency: "unbounded",
            discard: true,
          }),
          entries.length,
        ),
      ),
    withResolveLock: (effect) => Effect.andThen(ensureDirectory, lock.around(effect)),
  });
});

/** The file cache with AES-256-GCM: one file for each entry, in a directory with the mode `0700`. */
export const layer = (
  options: Options,
): Layer.Layer<Cache.Cache, never, FileSystem.FileSystem | Path.Path | EncryptionKey> =>
  Layer.effect(
    Cache.Cache,
    Effect.flatMap(EncryptionKey, (key) => make(options, Option.some(key))),
  );

/**
 * The file cache without encryption. Each entry is plaintext with the file mode `0600`. Envi
 * never selects this layer on its own: `encryption: "none"` is an explicit opt-in.
 */
export const layerPlaintext = (
  options: Options,
): Layer.Layer<Cache.Cache, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(Cache.Cache, make(options, Option.none()));
