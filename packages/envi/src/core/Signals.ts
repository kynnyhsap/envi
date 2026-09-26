import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { PlatformError } from "effect/PlatformError";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";

/** The signals that `run` handles, with their numbers. A shell reports `128 + number`. */
export const SignalNumber = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as const;

/** The schema of a signal name. */
export const SignalNameSchema = Schema.Literals(["SIGHUP", "SIGINT", "SIGTERM"]);

export type SignalName = typeof SignalNameSchema.Type;

/** One signal that the Envi process received. */
export interface Received {
  readonly name: SignalName;
  /**
   * `false` when the sender already delivered the signal to the child. A terminal sends `SIGINT`
   * to the whole foreground process group, so a second `SIGINT` would reach the child twice.
   */
  readonly forward: boolean;
}

/**
 * The signals of the Envi process. `run` subscribes while its child runs. The default never
 * emits. The entry point of a runtime provides the real stream.
 */
export const Signals = Context.Reference<Stream.Stream<Received>>("envi/Signals", {
  defaultValue: () => Stream.never,
});

/**
 * The signal that ended a child. The spawner reports it only in the message of the cause of the
 * exit code error, such as `Process interrupted due to receipt of signal: 'SIGINT'`.
 */
const endingSignal = (error: PlatformError): Option.Option<SignalName> => {
  const cause = error.reason.cause;
  const message = Predicate.isError(cause) ? cause.message : "";

  return Option.flatMap(
    Option.fromNullishOr(/receipt of signal: '(\w+)'/u.exec(message)?.[1]),
    Schema.decodeUnknownOption(SignalNameSchema),
  );
};

/**
 * Runs a child to its end and forwards each received signal to it. The command must set
 * `detached: false`, so that the child keeps the terminal of Envi.
 *
 * The exit code comes from the child alone. A terminal sends Ctrl-C to the child and to Envi at
 * once, so the child can end before Envi sees the signal.
 *
 * @returns The exit code. A child that `SIGHUP`, `SIGINT`, or `SIGTERM` ended gives
 *   `128 + number`, as a shell does. Nothing when another signal ended the child.
 */
export const supervise = Effect.fn("Signals.supervise")(function* (command: ChildProcess.Command) {
  const spawner = yield* ChildProcessSpawner;
  const signals = yield* Signals;

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command);

      // `kill` waits for the child to exit. Each forward runs in its own fiber, so the next signal
      // reaches the child while it still runs.
      yield* Effect.forkScoped(
        Stream.runForEach(signals, (signal) =>
          signal.forward
            ? Effect.forkScoped(Effect.ignore(handle.kill({ killSignal: signal.name })))
            : Effect.void,
        ),
      );

      // A child that a signal ended has no exit code.
      return yield* Effect.catch(
        Effect.map(handle.exitCode, (code): Option.Option<number> => Option.some(code)),
        (error) =>
          Effect.succeed(Option.map(endingSignal(error), (name) => 128 + SignalNumber[name])),
      );
    }),
  );
});
