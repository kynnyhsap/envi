import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
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
 * Runs a child to its end and forwards each received signal to it. The command must set
 * `detached: false`, so that the child keeps the terminal of Envi.
 *
 * @returns The exit code. A child that a received signal ended gives `128 + number`, as a shell
 *   does. Nothing when another signal ended the child.
 */
export const supervise = Effect.fn("Signals.supervise")(function* (command: ChildProcess.Command) {
  const spawner = yield* ChildProcessSpawner;
  const signals = yield* Signals;
  const received = yield* Ref.make(Option.none<SignalName>());

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command);

      yield* Effect.forkScoped(
        Stream.runForEach(signals, (signal) =>
          Effect.andThen(
            Ref.set(received, Option.some(signal.name)),
            signal.forward ? Effect.ignore(handle.kill({ killSignal: signal.name })) : Effect.void,
          ),
        ),
      );

      // A child that a signal ended has no exit code.
      return yield* Effect.catch(
        Effect.map(handle.exitCode, (code): Option.Option<number> => Option.some(code)),
        () =>
          Effect.map(
            Ref.get(received),
            Option.map((name) => 128 + SignalNumber[name]),
          ),
      );
    }),
  );
});
