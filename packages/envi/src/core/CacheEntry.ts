// The file format of one cache entry: the metadata, and the value in AES-256-GCM or in plaintext.
// The encryption binds the metadata, so an edit of any part fails the decryption.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import type * as Cache from "./Cache.ts";
import { CacheError, CacheFailure } from "./Errors.ts";

/**
 * The version of the entry format. An entry with another version is a miss, so a format change
 * needs no migration.
 */
export const formatVersion = 2;

/** How a file protects its value. The file stores the tag, so the values are frozen. */
const Cipher = {
  Aes256Gcm: "aes-256-gcm",
  /** Plaintext with the file mode `0600`. Envi never selects it on its own. */
  None: "none",
} as const;

const algorithm = "AES-GCM";

/** The bytes of the random nonce of one encryption. */
const ivLength = 12;

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
  encryption: Schema.Literal(Cipher.Aes256Gcm),
  iv: Schema.Uint8ArrayFromBase64,
  ciphertext: Schema.Uint8ArrayFromBase64,
});

const PlainEntry = Schema.Struct({
  ...Metadata.fields,
  encryption: Schema.Literal(Cipher.None),
  value: Schema.NullOr(Schema.String),
});

const EntryJson = Schema.fromJsonString(Schema.Union([EncryptedEntry, PlainEntry]));

/** One decoded entry file. */
export type Entry = typeof EntryJson.Type;

/**
 * The key of the entries of one cache. None for the plaintext cache. The effect reads the key on
 * the first use only.
 */
export type Keyring = Option.Option<Effect.Effect<CryptoKey, CacheError>>;

const unwritable = (detail: string): CacheError =>
  new CacheError({ reason: CacheFailure.Unwritable, detail });

/** The bytes that the encryption binds to an entry. */
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

/** Imports the 32 bytes of an AES key. */
export const importKey = (
  key: Redacted.Redacted<Uint8Array>,
): Effect.Effect<CryptoKey, CacheError> =>
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

/** Parses the text of an entry file. A corrupt file and another version are none. */
export const parse = (text: string): Effect.Effect<Option.Option<Entry>> =>
  Effect.option(Schema.decodeEffect(EntryJson)(text));

/**
 * The record of an entry. An encrypted entry needs the key, and the plaintext cache reads only
 * plaintext entries. An entry that does not decrypt is none.
 */
export const toRecord = (
  entry: Entry,
  keyring: Keyring,
): Effect.Effect<Option.Option<Cache.CacheRecord>, CacheError> =>
  Effect.gen(function* () {
    const metadata = {
      provider: entry.provider,
      reference: entry.reference,
      resolvedAt: entry.resolvedAt,
    };

    if (entry.encryption === Cipher.None) {
      return Option.isNone(keyring)
        ? Option.some({
            ...metadata,
            value: Option.map(Option.fromNullOr(entry.value), (value) => Redacted.make(value)),
          })
        : Option.none();
    }

    if (Option.isNone(keyring)) {
      return Option.none();
    }

    const secretKey = yield* keyring.value;

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

/** The text of the entry file of one record. */
export const encode = (
  key: string,
  record: Cache.CacheRecord,
  keyring: Keyring,
): Effect.Effect<string, CacheError> =>
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

    if (Option.isNone(keyring)) {
      return {
        ...metadata,
        encryption: Cipher.None,
        value: Option.getOrNull(Option.map(record.value, Redacted.value)),
      };
    }

    const secretKey = yield* keyring.value;
    const iv = crypto.getRandomValues(new Uint8Array(ivLength));

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
      encryption: Cipher.Aes256Gcm,
      iv,
      ciphertext: new Uint8Array(ciphertext),
    };
  }).pipe(
    Effect.flatMap((entry) =>
      Effect.mapError(Schema.encodeEffect(EntryJson)(entry), () =>
        unwritable("Envi cannot encode a cache entry."),
      ),
    ),
  );
