import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import * as Cache from "./Cache.ts";
import { CacheError, CacheFailure } from "./Errors.ts";

/**
 * The version of the entry format. An entry with another version is a miss, so a format change
 * needs no migration.
 */
export const formatVersion = 1;

/** The name of the lock file inside the cache directory. */
export const lockFileName = "resolve.lock";

/** How the file cache protects an entry. */
export const Encryption = {
  /** AES-256-GCM with a key from the `EncryptionKey` service. */
  Aes256Gcm: "aes-256-gcm",
  /** Plaintext with the file mode `0600`. Envi never selects it on its own. */
  None: "none",
} as const;

/** The schema of `Encryption`. */
export const EncryptionSchema = Schema.Literals([Encryption.Aes256Gcm, Encryption.None]);

export type Encryption = typeof EncryptionSchema.Type;

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

const Metadata = Schema.Struct({
  version: Schema.Literal(formatVersion),
  key: Schema.String,
  provider: Schema.String,
  reference: Schema.String,
  resolvedAt: Schema.Number,
});

const EncryptedEntry = Schema.Struct({
  ...Metadata.fields,
  encryption: Schema.Literal(Encryption.Aes256Gcm),
  iv: Schema.Uint8ArrayFromBase64,
  ciphertext: Schema.Uint8ArrayFromBase64,
});

const PlainEntry = Schema.Struct({
  ...Metadata.fields,
  encryption: Schema.Literal(Encryption.None),
  value: Schema.String,
});

const Entry = Schema.fromJsonString(Schema.Union([EncryptedEntry, PlainEntry]));

type Entry = typeof Entry.Type;

const entrySuffix = ".json";

const algorithm = "AES-GCM";

const unreadable = (detail: string): CacheError =>
  new CacheError({ reason: CacheFailure.Unreadable, detail });

const unwritable = (detail: string): CacheError =>
  new CacheError({ reason: CacheFailure.Unwritable, detail });

/** The bytes that the encryption binds to an entry. An edit of any part fails the decryption. */
const boundData = (entry: typeof Metadata.Type): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(
    JSON.stringify([entry.version, entry.key, entry.provider, entry.reference, entry.resolvedAt]),
  );

const importKey = (key: Redacted.Redacted<Uint8Array>) =>
  Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey("raw", new Uint8Array(Redacted.value(key)), algorithm, false, [
        "encrypt",
        "decrypt",
      ]),
    catch: () =>
      new CacheError({
        reason: CacheFailure.KeyUnavailable,
        detail: "The encryption key is not a valid AES key of 32 bytes.",
      }),
  });

const fileNameOf = (key: string): Effect.Effect<string> =>
  Effect.map(
    Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))),
    (digest) => `${Encoding.encodeHex(new Uint8Array(digest))}${entrySuffix}`,
  );

const make = Effect.fn("FileCache.make")(function* (
  options: Options,
  encryptionKey: Option.Option<Effect.Effect<Redacted.Redacted<Uint8Array>, CacheError>>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lockWait = options.lockWait ?? "2 minutes";
  const lockStaleAfter = Duration.fromInputUnsafe(options.lockStaleAfter ?? "30 seconds");
  const lockFile = path.join(options.directory, lockFileName);

  // The key and the 1Password client are both slow. Envi reads the key on the first use only.
  const cryptoKey = Option.isNone(encryptionKey)
    ? Option.none()
    : Option.some(yield* Effect.cached(Effect.flatMap(encryptionKey.value, importKey)));

  const ensureDirectory = fs
    .makeDirectory(options.directory, { recursive: true, mode: 0o700 })
    .pipe(Effect.mapError(() => unwritable("Envi cannot create the cache directory.")));

  const readEntry = (file: string): Effect.Effect<Option.Option<Entry>> =>
    fs.readFileString(file).pipe(Effect.flatMap(Schema.decodeEffect(Entry)), Effect.option);

  /** A missing, a corrupt, a moved, and an edited entry are all absent. */
  const readRecord = (key: string): Effect.Effect<Option.Option<Cache.CacheRecord>, CacheError> =>
    Effect.gen(function* () {
      const file = path.join(options.directory, yield* fileNameOf(key));
      const found = Option.filter(yield* readEntry(file), (entry) => entry.key === key);

      if (Option.isNone(found)) {
        return Option.none();
      }

      const entry = found.value;

      const metadata = {
        provider: entry.provider,
        reference: entry.reference,
        resolvedAt: entry.resolvedAt,
      };

      if (entry.encryption === Encryption.None) {
        return Option.isNone(cryptoKey)
          ? Option.some({ ...metadata, value: Redacted.make(entry.value) })
          : Option.none();
      }

      if (Option.isNone(cryptoKey)) {
        return Option.none();
      }

      const secretKey = yield* cryptoKey.value;

      const plaintext = yield* Effect.option(
        Effect.tryPromise(() =>
          crypto.subtle.decrypt(
            { name: algorithm, iv: new Uint8Array(entry.iv), additionalData: boundData(entry) },
            secretKey,
            new Uint8Array(entry.ciphertext),
          ),
        ),
      );

      return Option.map(plaintext, (bytes) => ({
        ...metadata,
        value: Redacted.make(new TextDecoder().decode(bytes)),
      }));
    });

  const encodeEntry = (key: string, record: Cache.CacheRecord): Effect.Effect<string, CacheError> =>
    Effect.gen(function* () {
      const metadata = {
        version: formatVersion,
        key,
        provider: record.provider,
        reference: record.reference,
        resolvedAt: record.resolvedAt,
      } as const;

      if (Option.isNone(cryptoKey)) {
        return { ...metadata, encryption: Encryption.None, value: Redacted.value(record.value) };
      }

      const secretKey = yield* cryptoKey.value;
      const iv = crypto.getRandomValues(new Uint8Array(12));

      const ciphertext = yield* Effect.tryPromise({
        try: () =>
          crypto.subtle.encrypt(
            { name: algorithm, iv, additionalData: boundData(metadata) },
            secretKey,
            new TextEncoder().encode(Redacted.value(record.value)),
          ),
        catch: () => unwritable("Envi cannot encrypt a cache entry."),
      });

      return {
        ...metadata,
        encryption: Encryption.Aes256Gcm,
        iv,
        ciphertext: new Uint8Array(ciphertext),
      };
    }).pipe(
      Effect.flatMap((entry) =>
        Effect.mapError(Schema.encodeEffect(Entry)(entry), () =>
          unwritable("Envi cannot encode a cache entry."),
        ),
      ),
    );

  /** Writes a temp file and renames it, so a reader never sees a partial entry. */
  const writeRecord = (key: string, record: Cache.CacheRecord): Effect.Effect<void, CacheError> =>
    Effect.gen(function* () {
      const file = path.join(options.directory, yield* fileNameOf(key));
      const temp = `${file}.${Encoding.encodeHex(crypto.getRandomValues(new Uint8Array(6)))}.tmp`;
      const text = yield* encodeEntry(key, record);

      yield* fs.writeFileString(temp, text, { flag: "wx", mode: 0o600 }).pipe(
        Effect.andThen(fs.rename(temp, file)),
        Effect.mapError(() => unwritable("Envi cannot write a cache entry.")),
      );
    });

  const entryFiles = fs.readDirectory(options.directory).pipe(
    Effect.map((names) =>
      names
        .filter((name) => name.endsWith(entrySuffix))
        .map((name) => path.join(options.directory, name)),
    ),
    Effect.catchIf(
      (error) => Predicate.isTagged(error.reason, "NotFound"),
      () => Effect.succeed([]),
    ),
    Effect.mapError(() => unreadable("Envi cannot read the cache directory.")),
  );

  const remove = (file: string) =>
    fs
      .remove(file, { force: true })
      .pipe(Effect.mapError(() => unwritable("Envi cannot remove a cache entry.")));

  const writeLockTemp = (now: number) => {
    const temp = `${lockFile}.${crypto.randomUUID()}`;

    return Effect.as(fs.writeFileString(temp, String(now), { flag: "wx", mode: 0o600 }), temp);
  };

  const tryTakeLock: Effect.Effect<boolean, CacheError> = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;

    // A lock file always holds a complete time: Envi writes a temp file and links it. A reader
    // never sees a lock file that is empty or half written.
    const taken = yield* Effect.acquireUseRelease(
      writeLockTemp(now),
      (temp) =>
        fs.link(temp, lockFile).pipe(
          Effect.as(true),
          Effect.catchIf(
            (error) => Predicate.isTagged(error.reason, "AlreadyExists"),
            () => Effect.succeed(false),
          ),
        ),
      (temp) => Effect.ignore(fs.remove(temp, { force: true })),
    ).pipe(Effect.mapError(() => unwritable("Envi cannot create the lock file of the cache.")));

    if (taken) {
      return true;
    }

    // A lock file without a readable time, or with an old time, belongs to a crashed owner.
    const heldSince = yield* fs.readFileString(lockFile).pipe(
      Effect.map((text) => Number(text)),
      Effect.orElseSucceed(() => now),
    );

    if (now - heldSince > Duration.toMillis(lockStaleAfter) || Number.isNaN(heldSince)) {
      yield* remove(lockFile);

      return yield* Effect.suspend(() => tryTakeLock);
    }

    return false;
  });

  const takeLock = tryTakeLock.pipe(
    Effect.repeat({ until: (taken) => taken, schedule: Schedule.spaced("100 millis") }),
    Effect.timeoutOrElse({
      duration: lockWait,
      orElse: () =>
        Effect.fail(
          new CacheError({
            reason: CacheFailure.LockTimeout,
            detail: `Another Envi process holds ${lockFile}. Remove the file if no Envi process runs.`,
          }),
        ),
    }),
  );

  /** The owner renews the time in the lock file, so a long provider prompt does not look crashed. */
  const renewLock = Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) =>
      Effect.acquireUseRelease(
        writeLockTemp(now),
        (temp) => fs.rename(temp, lockFile),
        (temp) => Effect.ignore(fs.remove(temp, { force: true })),
      ),
    ),
    Effect.ignore,
    Effect.repeat(Schedule.spaced(Duration.divideUnsafe(lockStaleAfter, 3))),
  );

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
    removeMany: (keys) =>
      Effect.forEach(
        keys,
        (key) =>
          Effect.flatMap(fileNameOf(key), (name) => remove(path.join(options.directory, name))),
        { concurrency: "unbounded", discard: true },
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
      Effect.flatMap(entryFiles, (files) =>
        Effect.as(
          Effect.forEach(files, remove, { concurrency: "unbounded", discard: true }),
          files.length,
        ),
      ),
    withResolveLock: (effect) =>
      Effect.acquireUseRelease(
        Effect.andThen(ensureDirectory, takeLock),
        () => Effect.raceFirst(effect, Effect.andThen(renewLock, Effect.never)),
        () => Effect.ignore(remove(lockFile)),
      ),
    directory: Option.some(options.directory),
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
