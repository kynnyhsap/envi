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
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import * as Cache from "./Cache.ts";
import * as Digest from "./Digest.ts";
import { CacheError, CacheFailure } from "./Errors.ts";

/**
 * The version of the entry format. An entry with another version is a miss, so a format change
 * needs no migration.
 */
export const formatVersion = 2;

/**
 * The name of the lock file inside the cache directory.
 *
 * The lock file holds one integer, the epoch milliseconds, and nothing else. This content is
 * frozen since cache format 1: an older Envi treats any other content as a crashed lock and
 * takes it. Put future data in a second file. A new lock protocol needs a new file name.
 */
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
  /** `false` when the provider reported `NotFound`. The encryption binds it. */
  found: Schema.Boolean,
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
  value: Schema.NullOr(Schema.String),
});

const Entry = Schema.fromJsonString(Schema.Union([EncryptedEntry, PlainEntry]));

type Entry = typeof Entry.Type;

const entrySuffix = ".json";

/** The suffix of an entry that Envi writes and has not renamed yet. `clear` removes it. */
const tempSuffix = ".tmp";

const algorithm = "AES-GCM";

const unreadable = (detail: string): CacheError =>
  new CacheError({ reason: CacheFailure.Unreadable, detail });

const unwritable = (detail: string): CacheError =>
  new CacheError({ reason: CacheFailure.Unwritable, detail });

/** The bytes that the encryption binds to an entry. An edit of any part fails the decryption. */
const boundData = (entry: typeof Metadata.Type): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(
    JSON.stringify([
      entry.version,
      entry.key,
      entry.provider,
      entry.reference,
      entry.resolvedAt,
      entry.found,
    ]),
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
  Effect.map(Digest.sha256Hex(key), (digest) => `${digest}${entrySuffix}`);

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
          ? Option.some({
              ...metadata,
              value: Option.map(Option.fromNullOr(entry.value), (value) => Redacted.make(value)),
            })
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
        value: entry.found
          ? Option.some(Redacted.make(new TextDecoder().decode(bytes)))
          : Option.none(),
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
        found: Option.isSome(record.value),
      } as const;

      const plaintext = Option.getOrElse(Option.map(record.value, Redacted.value), () => "");

      if (Option.isNone(cryptoKey)) {
        return {
          ...metadata,
          encryption: Encryption.None,
          value: Option.getOrNull(Option.map(record.value, Redacted.value)),
        };
      }

      const secretKey = yield* cryptoKey.value;
      const iv = crypto.getRandomValues(new Uint8Array(12));

      const ciphertext = yield* Effect.tryPromise({
        try: () =>
          crypto.subtle.encrypt(
            { name: algorithm, iv, additionalData: boundData(metadata) },
            secretKey,
            new TextEncoder().encode(plaintext),
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

  /**
   * Writes a temp file and renames it, so a reader never sees a partial entry. The release
   * removes the temp file also after an interrupt, because a plaintext entry holds a secret.
   */
  const writeRecord = (key: string, record: Cache.CacheRecord): Effect.Effect<void, CacheError> =>
    Effect.gen(function* () {
      const file = path.join(options.directory, yield* fileNameOf(key));
      const suffix = Encoding.encodeHex(crypto.getRandomValues(new Uint8Array(6)));
      const temp = `${file}.${suffix}${tempSuffix}`;
      const text = yield* encodeEntry(key, record);

      yield* Effect.acquireUseRelease(
        Effect.as(fs.writeFileString(temp, text, { flag: "wx", mode: 0o600 }), temp),
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

  const writeLockTemp = (now: number) => {
    const temp = `${lockFile}.${crypto.randomUUID()}`;

    return Effect.as(fs.writeFileString(temp, String(now), { flag: "wx", mode: 0o600 }), temp);
  };

  /** The text of the lock file. None when the lock file is missing or does not read. */
  const lockText = Effect.option(fs.readFileString(lockFile));

  /**
   * Removes a stale lock. The rename to a unique name is atomic, so only one process moves the
   * file. When the moved file holds another text, another process took the lock after the read:
   * the link puts its lock back, unless a third process holds the lock already.
   */
  const removeStaleLock = (observed: string) =>
    Effect.gen(function* () {
      const moved = `${lockFile}.${crypto.randomUUID()}.stale`;

      const renamed = yield* fs.rename(lockFile, moved).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );

      if (!renamed) {
        return;
      }

      const text = yield* Effect.orElseSucceed(fs.readFileString(moved), () => observed);

      if (text !== observed) {
        yield* Effect.ignore(fs.link(moved, lockFile));
      }

      yield* Effect.ignore(fs.remove(moved, { force: true }));
    });

  /** Takes the lock once. Some holds the time that this process wrote into the lock file. */
  const tryTakeLock: Effect.Effect<Option.Option<number>, CacheError> = Effect.gen(function* () {
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
      return Option.some(now);
    }

    // A lock file without a readable time, or with an old time, belongs to a crashed owner.
    const observed = yield* lockText;

    if (Option.isNone(observed)) {
      return yield* Effect.suspend(() => tryTakeLock);
    }

    const heldSince = Number(observed.value);

    if (Number.isNaN(heldSince) || now - heldSince > Duration.toMillis(lockStaleAfter)) {
      yield* removeStaleLock(observed.value);

      return yield* Effect.suspend(() => tryTakeLock);
    }

    return Option.none();
  });

  /** Tries to take the lock every 100 ms until it holds the time of this process. */
  const waitForLock: Effect.Effect<number, CacheError> = Effect.flatMap(
    tryTakeLock,
    Option.match({
      onSome: Effect.succeed,
      onNone: () =>
        Effect.andThen(
          Effect.sleep("100 millis"),
          Effect.suspend(() => waitForLock),
        ),
    }),
  );

  const takeLock = waitForLock.pipe(
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

  /** `true` while the lock file holds the time that this process wrote last. */
  const ownsLock = (owned: Ref.Ref<number>) =>
    Effect.map(Effect.all([lockText, Ref.get(owned)]), ([text, time]) =>
      Option.contains(text, String(time)),
    );

  /**
   * The owner renews the time in the lock file, so a long provider prompt does not look crashed.
   * It renews only its own lock: after a steal, the lock belongs to the other process. One renewal
   * is uninterruptible, so the lock file and `owned` always hold the same time for the release.
   */
  const renewLock = (owned: Ref.Ref<number>) => {
    const interval = Duration.divideUnsafe(lockStaleAfter, 3);

    const renew = Effect.gen(function* () {
      if (!(yield* ownsLock(owned))) {
        return;
      }

      const now = yield* Clock.currentTimeMillis;

      yield* Effect.acquireUseRelease(
        writeLockTemp(now),
        (temp) => fs.rename(temp, lockFile),
        (temp) => Effect.ignore(fs.remove(temp, { force: true })),
      );

      yield* Ref.set(owned, now);
    }).pipe(Effect.ignore, Effect.uninterruptible);

    return Effect.andThen(Effect.sleep(interval), renew).pipe(Effect.repeat(Schedule.forever));
  };

  /** Removes the lock only while it holds the time of this process. */
  const releaseLock = (owned: Ref.Ref<number>) =>
    Effect.flatMap(ownsLock(owned), (owns) =>
      owns ? Effect.ignore(remove(lockFile)) : Effect.void,
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
      Effect.flatMap(Effect.all([entryFiles, tempFiles]), ([entries, temps]) =>
        Effect.as(
          Effect.forEach([...entries, ...temps], remove, {
            concurrency: "unbounded",
            discard: true,
          }),
          entries.length,
        ),
      ),
    withResolveLock: (effect) =>
      Effect.acquireUseRelease(
        ensureDirectory.pipe(
          Effect.andThen(takeLock),
          Effect.flatMap((time) => Ref.make(time)),
        ),
        (owned) => Effect.raceFirst(effect, Effect.andThen(renewLock(owned), Effect.never)),
        releaseLock,
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
