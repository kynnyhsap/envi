import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { CacheError, CacheFailure } from "./Errors.ts";
import { EncryptionKey } from "./FileCache.ts";
import * as Keychain from "./Keychain.ts";

const handle = (exitCode: number, stdout: string) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    stdout: Stream.encodeText(Stream.make(stdout)),
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });

/** A faithful `security` command: one password item, and the exit code 44 for a missing item. */
const fakeSecurity = (stored: Ref.Ref<Option.Option<string>>, seenArgs: Array<string>) =>
  ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      if (!ChildProcess.isStandardCommand(command) || command.command !== "security") {
        return yield* Effect.die("the fake accepts only the security command");
      }

      seenArgs.push(...command.args);

      if (command.args[0] === "find-generic-password") {
        return Option.match(yield* Ref.get(stored), {
          onNone: () => handle(44, ""),
          onSome: (password) => handle(0, `${password}\n`),
        });
      }

      const input = command.options.stdin;

      if (!Predicate.isObject(input) || !Stream.isStream(input)) {
        return yield* Effect.die("the fake expects the add command on stdin");
      }

      const script = yield* Stream.mkString(Stream.decodeText(input));
      const password = script.trim().split(" ").at(-1) ?? "";

      if (Option.isSome(yield* Ref.get(stored))) {
        return handle(45, "");
      }

      yield* Ref.set(stored, Option.some(password));

      return handle(0, "");
    }),
  );

const read = Effect.flatMap(EncryptionKey, (key) => key);

const layerWith = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
  Layer.provide(Keychain.layer, Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner));

describe("Keychain", () => {
  it.effect("creates a key of 32 bytes once and keeps it out of the arguments", () =>
    Effect.gen(function* () {
      const stored = yield* Ref.make(Option.none<string>());
      const seenArgs: Array<string> = [];
      const layer = layerWith(fakeSecurity(stored, seenArgs));

      const first = Redacted.value(yield* Effect.provide(read, layer));
      const second = Redacted.value(yield* Effect.provide(read, layer));
      const password = Option.getOrThrow(yield* Ref.get(stored));

      expect(first.length).toBe(32);
      expect(second).toEqual(first);
      expect(seenArgs).not.toContain(password);
      expect(seenArgs.join(" ")).not.toContain(password);
    }),
  );

  it.effect("fails with KeyUnavailable for a stored value that is not a key", () =>
    Effect.gen(function* () {
      const stored = yield* Ref.make(Option.some("not-a-key"));
      const error = yield* Effect.flip(Effect.provide(read, layerWith(fakeSecurity(stored, []))));

      expect(error).toBeInstanceOf(CacheError);
      expect(error.reason).toBe(CacheFailure.KeyUnavailable);
      expect(yield* Ref.get(stored)).toEqual(Option.some("not-a-key"));
    }),
  );

  it.effect("fails with KeyUnavailable without the security command", () =>
    Effect.gen(function* () {
      const missing = ChildProcessSpawner.make(() =>
        Effect.fail(
          // The `_tag` is the input of the constructor of Effect. No other constructor exists.
          // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction
          PlatformError.systemError({ _tag: "NotFound", module: "ChildProcess", method: "spawn" }),
        ),
      );

      const error = yield* Effect.flip(Effect.provide(read, layerWith(missing)));

      expect(error.reason).toBe(CacheFailure.KeyUnavailable);
    }),
  );
});
