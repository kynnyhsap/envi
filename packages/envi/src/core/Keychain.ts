import * as EffectConfig from "effect/Config";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";

import * as Digest from "./Digest.ts";
import { CacheError, CacheFailure } from "./Errors.ts";
import { EncryptionKey } from "./FileCache.ts";
import * as Timing from "./Timing.ts";

/** The service name of the keychain item. */
export const keychainService = "envi";

/** The account name of the keychain item. */
export const keychainAccount = "cache-encryption-key";

/** The variable of a key from outside, for a system without a keychain, such as a CI runner. */
export const keyVariable = "ENVI_CACHE_KEY";

/** The keychains that Envi can use. The entry point selects one from the platform. */
export const Store = {
  /** The macOS Keychain, through the `security` command. */
  MacOs: "macos",
  /** The Secret Service of Linux, such as GNOME Keyring, through the `secret-tool` command. */
  SecretService: "secret-service",
  /** No keychain. Only `ENVI_CACHE_KEY` gives a key. */
  None: "none",
} as const;

/** The schema of `Store`. */
export const StoreSchema = Schema.Literals([Store.MacOs, Store.SecretService, Store.None]);

export type Store = typeof StoreSchema.Type;

const keyLength = 32;

/** The command of one keychain, and how it finds and adds the item. */
interface Backend {
  readonly name: string;
  readonly command: string;
  readonly find: ReadonlyArray<string>;
  /** `true` when the exit code and the output of `find` mean that the item does not exist. */
  readonly isMissing: (exitCode: number, stdout: string) => boolean;
  /** Writes the key through stdin, because the arguments of a process are visible to others. */
  readonly add: (hex: string) => { readonly args: ReadonlyArray<string>; readonly stdin: string };
}

const backends: Readonly<Record<Exclude<Store, typeof Store.None>, Backend>> = {
  [Store.MacOs]: {
    name: "the macOS Keychain",
    command: "security",
    find: ["find-generic-password", "-s", keychainService, "-a", keychainAccount, "-w"],
    // The exit code of `security find-generic-password` for a missing item.
    isMissing: (exitCode) => exitCode === 44,
    add: (hex) => ({
      args: ["-i"],
      stdin: `add-generic-password -s ${keychainService} -a ${keychainAccount} -w ${hex}\n`,
    }),
  },
  [Store.SecretService]: {
    name: "the Secret Service",
    command: "secret-tool",
    find: ["lookup", "service", keychainService, "account", keychainAccount],
    // `secret-tool lookup` prints nothing and exits with 1 for a missing item.
    isMissing: (exitCode, stdout) => exitCode === 1 && stdout.trim() === "",
    add: (hex) => ({
      args: [
        "store",
        "--label=Envi cache key",
        "service",
        keychainService,
        "account",
        keychainAccount,
      ],
      stdin: hex,
    }),
  },
};

const unavailable = (detail: string): CacheError =>
  new CacheError({ reason: CacheFailure.KeyUnavailable, detail });

/** A key from `ENVI_CACHE_KEY`: the SHA-256 digest of the text gives the 32 bytes of any text. */
const fromVariable = Effect.gen(function* () {
  const text = yield* Effect.mapError(EffectConfig.option(EffectConfig.Redacted(keyVariable)), () =>
    unavailable(`Envi cannot read the variable ${keyVariable}.`),
  );

  return yield* Option.match(
    Option.filter(text, (value) => Redacted.value(value).trim() !== ""),
    {
      onNone: () => Effect.succeedNone,
      onSome: (value) =>
        Effect.map(Digest.sha256(Redacted.value(value)), (digest) =>
          Option.some(Redacted.make(digest)),
        ),
    },
  );
});

const fromBackend = (backend: Backend) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner;

    /** Runs the command of the keychain and returns the exit code and stdout. */
    const run = (args: ReadonlyArray<string>, stdin: Option.Option<string>) =>
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make(backend.command, args, {
              stdin: Option.match(stdin, {
                onNone: () => "ignore" as const,
                onSome: (text) => Stream.encodeText(Stream.make(text)),
              }),
              stderr: "ignore",
            }),
          );

          const [stdout, exitCode] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
            { concurrency: 2 },
          );

          return { stdout, exitCode };
        }),
      ).pipe(
        Effect.mapError(() =>
          unavailable(
            `Envi cannot run the \`${backend.command}\` command to read ${backend.name}.`,
          ),
        ),
      );

    const find = run(backend.find, Option.none());

    const decodeKey = (text: string): Effect.Effect<Redacted.Redacted<Uint8Array>, CacheError> => {
      const decoded = Encoding.decodeHex(text.trim());

      return Result.isSuccess(decoded) && decoded.success.length === keyLength
        ? Effect.succeed(Redacted.make(decoded.success))
        : Effect.fail(
            unavailable(
              `The item "${keychainService}" in ${backend.name} does not hold a key. Delete the item, and Envi creates a new key.`,
            ),
          );
    };

    const create = Effect.suspend(() => {
      const { args, stdin } = backend.add(
        Encoding.encodeHex(crypto.getRandomValues(new Uint8Array(keyLength))),
      );

      return run(args, Option.some(stdin));
    });

    return Effect.gen(function* () {
      const found = yield* find;

      if (found.exitCode === 0 && found.stdout.trim() !== "") {
        return yield* decodeKey(found.stdout);
      }

      if (!backend.isMissing(found.exitCode, found.stdout)) {
        return yield* unavailable(`${backend.name} refused access to the Envi key.`);
      }

      // A parallel Envi process can create the key first. The second read returns the key that won.
      yield* create;

      const created = yield* find;

      return created.exitCode === 0 && created.stdout.trim() !== ""
        ? yield* decodeKey(created.stdout)
        : yield* unavailable(`Envi cannot store its key in ${backend.name}.`);
    });
  });

/**
 * The encryption key of the cache: `ENVI_CACHE_KEY` first, then the keychain of the platform.
 * Envi creates the keychain item on the first use.
 */
export const layer = (store: Store): Layer.Layer<EncryptionKey, never, ChildProcessSpawner> =>
  Layer.effect(
    EncryptionKey,
    Effect.gen(function* () {
      const fromStore =
        store === Store.None
          ? Effect.fail(unavailable(`This system has no keychain, and ${keyVariable} is not set.`))
          : yield* fromBackend(backends[store]);

      return Effect.flatMap(fromVariable, (key) =>
        Option.match(key, { onNone: () => fromStore, onSome: Effect.succeed }),
      ).pipe(Timing.measure("keychain.key"));
    }),
  );
