import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Runtime from "effect/Runtime";
import * as Stream from "effect/Stream";

// The signals of the running process. This module is the only place that calls `process.on`.
import { Signals } from "./core/index.ts";

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
          // A pipe on stdin, such as `cmd | envi run -- srv`, still leaves the terminal on stdout.
          const hasTerminal = process.stdin.isTTY || process.stdout.isTTY || process.stderr.isTTY;
          const forward = name !== "SIGINT" || !hasTerminal;

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
    for (const name of names) {
      process.removeListener(name, onSignal);
    }

    teardown(exit, (code) => {
      if (receivedSignal || code !== 0) {
        process.exit(code);
      }
    });
  });

  // SIGHUP interrupts too, so a closed terminal releases the resolve lock of the cache.
  for (const name of names) {
    process.on(name, onSignal);
  }
});
