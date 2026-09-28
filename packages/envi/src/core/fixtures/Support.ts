// Shared parts of the unit tests: the environment of a test, the Node platform, Envi on the
// in-memory cache, a cache record, a finished child process, and a manual clock.
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import * as Clock from "effect/Clock";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Redacted from "effect/Redacted";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as Cache from "../Cache.ts";
import * as Envi from "../Envi.ts";

/** Runs an effect with `env` as the only environment variables that `Config` reads. */
export const withEnv = (env: Readonly<Record<string, string>>) =>
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)));

/** The real file system and paths of Node. */
export const nodePlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

/** Envi on the in-memory cache. */
export const enviLayer = (options?: Envi.LayerOptions) =>
  Layer.provide(Envi.layer(options), Cache.layerMemory);

/** A cache record of the in-memory provider with a value. */
export const cacheRecord = (value: string, resolvedAt = 1000): Cache.CacheRecord => ({
  provider: "memory",
  reference: "memory://token",
  value: Option.some(Redacted.make(value)),
  resolvedAt,
});

/** A child process that already exited with `exitCode` and printed `stdout`. */
export const exitedProcess = (exitCode: number, stdout = "") =>
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

/** One fiber that sleeps on a manual clock. */
interface Sleep {
  readonly millis: number;
  readonly wakeAt: number;
  readonly wake: Deferred.Deferred<void>;
}

const nanosPerMilli = 1_000_000n;

/**
 * A clock that moves only by `adjust`. Unlike `TestClock`, it shows each pending sleep: a test
 * waits until a fiber sleeps, and never sleeps itself. `provide` gives the clock to one effect.
 */
export const makeManualClock = Effect.gen(function* () {
  let now = 0;
  const sleeps = yield* SubscriptionRef.make<ReadonlyArray<Sleep>>([]);

  const without = (sleep: Sleep) =>
    SubscriptionRef.update(sleeps, (all) => all.filter((other) => other !== sleep));

  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: () => now,
    currentTimeMillis: Effect.sync(() => now),
    currentTimeNanosUnsafe: () => BigInt(now) * nanosPerMilli,
    currentTimeNanos: Effect.sync(() => BigInt(now) * nanosPerMilli),
    monotonicTimeNanosUnsafe: () => BigInt(now) * nanosPerMilli,
    monotonicTimeNanos: Effect.sync(() => BigInt(now) * nanosPerMilli),
    sleep: (duration) =>
      Effect.gen(function* () {
        const millis = Duration.toMillis(duration);

        // A schedule sleeps for no time between two repetitions. That sleep ends at once.
        if (millis <= 0) {
          return;
        }

        const sleep: Sleep = { millis, wakeAt: now + millis, wake: yield* Deferred.make<void>() };

        yield* Effect.acquireUseRelease(
          SubscriptionRef.update(sleeps, (all) => [...all, sleep]),
          () => Deferred.await(sleep.wake),
          () => without(sleep),
        );
      }),
  };

  return {
    provide: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.provideService(effect, Clock.Clock, clock),
    /** Moves the time forward, and wakes every sleep that ends by then. */
    adjust: (duration: Duration.Input) =>
      Effect.gen(function* () {
        now += Duration.toMillis(duration);

        const due = (yield* SubscriptionRef.get(sleeps)).filter((sleep) => sleep.wakeAt <= now);

        yield* Effect.forEach(due, (sleep) =>
          Effect.andThen(without(sleep), Deferred.succeed(sleep.wake, undefined)),
        );
      }),
    /** Waits until a fiber sleeps for `duration`. */
    whenSleeping: (duration: Duration.Input) =>
      SubscriptionRef.changes(sleeps).pipe(
        Stream.filter((all) => all.some((sleep) => sleep.millis === Duration.toMillis(duration))),
        Stream.runHead,
        Effect.asVoid,
      ),
  };
});
