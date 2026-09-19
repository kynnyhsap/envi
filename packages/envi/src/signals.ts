// The signals of the running process. This module is the only place that calls `process.on`.
import { Signals } from "@envi/core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Runtime from "effect/Runtime";
import * as Stream from "effect/Stream";

const names: ReadonlyArray<Signals.SignalName> = ["SIGHUP", "SIGINT", "SIGTERM"];

/**
 * The signals of the process. The handlers exist only while a subscriber runs, so an import of
 * Envi installs no handler.
 */
export const processSignals: Stream.Stream<Signals.Received> = Stream.callback((queue) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      names.map((name) => {
        const handler = () => {
          // A terminal sends SIGINT to the whole foreground process group, the child included.
          const forward = name !== "SIGINT" || !process.stdin.isTTY;

          Queue.offerUnsafe(queue, { name, forward });
        };

        process.on(name, handler);

        return [name, handler] as const;
      }),
    ),
    (handlers) =>
      Effect.sync(() => {
        for (const [name, handler] of handlers) {
          process.removeListener(name, handler);
        }
      }),
  ),
);

/** Provides the signals of the process to `run`. */
export const layer = Layer.succeed(Signals.Signals, processSignals);

/**
 * Runs the main Effect of the CLI. A signal interrupts the Effect, except while `run` handles
 * the signals: then the child decides when Envi ends.
 */
export const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  let receivedSignal = false;

  const onSignal = (name: NodeJS.Signals) => {
    // More than this listener: `processSignals` has a subscriber.
    if (process.listenerCount(name) > 1) {
      return;
    }

    receivedSignal = true;
    fiber.interruptUnsafe(fiber.id);
  };

  fiber.addObserver((exit) => {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);

    teardown(exit, (code) => {
      if (receivedSignal || code !== 0) {
        process.exit(code);
      }
    });
  });

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
});
