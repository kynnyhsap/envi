import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";

import { CacheError, CacheFailure } from "./Errors.ts";
import { EncryptionKey } from "./FileCache.ts";
import * as Timing from "./Timing.ts";

/** The service name of the Keychain item. */
export const keychainService = "envi";

/** The account name of the Keychain item. */
export const keychainAccount = "cache-encryption-key";

const securityCommand = "security";

/** The exit code of `security find-generic-password` for a missing item. */
const itemNotFound = 44;

const keyLength = 32;

const unavailable = (detail: string): CacheError =>
  new CacheError({ reason: CacheFailure.KeyUnavailable, detail });

const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner;

  /** Runs `security` and returns the exit code and stdout. */
  const security = (args: ReadonlyArray<string>, stdin: Option.Option<string>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(
          ChildProcess.make(securityCommand, args, {
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
        unavailable("Envi cannot run the macOS `security` command to read the Keychain."),
      ),
    );

  const find = security(
    ["find-generic-password", "-s", keychainService, "-a", keychainAccount, "-w"],
    Option.none(),
  );

  const decodeKey = (text: string): Effect.Effect<Redacted.Redacted<Uint8Array>, CacheError> => {
    const decoded = Encoding.decodeHex(text.trim());

    return Result.isSuccess(decoded) && decoded.success.length === keyLength
      ? Effect.succeed(Redacted.make(decoded.success))
      : Effect.fail(
          unavailable(
            `The Keychain item "${keychainService}" does not hold a key. Delete the item, and Envi creates a new key.`,
          ),
        );
  };

  /** Writes the key through stdin, because the arguments of a process are visible to others. */
  const create = Effect.suspend(() =>
    security(
      ["-i"],
      Option.some(
        `add-generic-password -s ${keychainService} -a ${keychainAccount} -w ${Encoding.encodeHex(
          crypto.getRandomValues(new Uint8Array(keyLength)),
        )}\n`,
      ),
    ),
  );

  return Effect.gen(function* () {
    const found = yield* find;

    if (found.exitCode === 0) {
      return yield* decodeKey(found.stdout);
    }

    if (found.exitCode !== itemNotFound) {
      return yield* unavailable("The macOS Keychain refused access to the Envi key.");
    }

    // A parallel Envi process can create the key first. The second read returns the key that won.
    yield* create;

    const created = yield* find;

    return created.exitCode === 0
      ? yield* decodeKey(created.stdout)
      : yield* unavailable("Envi cannot store its key in the macOS Keychain.");
  }).pipe(Timing.measure("keychain.key"));
});

/** The encryption key from the macOS Keychain. Envi creates the key on the first use. */
export const layer: Layer.Layer<EncryptionKey, never, ChildProcessSpawner> = Layer.effect(
  EncryptionKey,
  make,
);
