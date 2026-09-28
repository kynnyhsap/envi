// The resolve lock of the file cache. It runs one resolution at a time across processes, also
// across worktrees that run different Envi versions against one cache directory.
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";

import { CacheError, CacheFailure } from "./Errors.ts";

/**
 * The name of the lock file inside the cache directory.
 *
 * The lock file holds one integer, the epoch milliseconds, and nothing else. This content is
 * frozen since cache format 1: an older Envi treats any other content as a crashed lock and
 * takes it. Put future data in a second file. A new lock protocol needs a new file name.
 */
export const lockFileName = "resolve.lock";

/** The time between two attempts to take a held lock. */
export const retryInterval: Duration.Input = "100 millis";

/** The number of renewals within the stale age, so one late renewal does not lose the lock. */
const renewalsPerStaleAge = 3;

/** The time between two renewals of a held lock. */
export const renewalInterval = (staleAfter: Duration.Duration): Duration.Duration =>
  Duration.divideUnsafe(staleAfter, renewalsPerStaleAge);

export interface Options {
  readonly directory: string;
  /** The longest wait for the lock. */
  readonly wait: Duration.Input;
  /** The age at which a lock counts as the lock of a crashed owner. */
  readonly staleAfter: Duration.Duration;
}

/** The lock of one cache directory. */
export interface Lock {
  /** Runs the effect while this process holds the lock. The directory must exist. */
  readonly around: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | CacheError, R>;
}

export const make = Effect.fn("CacheLock.make")(function* (options: Options) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lockFile = path.join(options.directory, lockFileName);

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
    ).pipe(
      Effect.mapError(
        () =>
          new CacheError({
            reason: CacheFailure.Unwritable,
            detail: "Envi cannot create the lock file of the cache.",
          }),
      ),
    );

    if (taken) {
      return Option.some(now);
    }

    // A lock file without a readable time, or with an old time, belongs to a crashed owner.
    const observed = yield* lockText;

    if (Option.isNone(observed)) {
      return yield* Effect.suspend(() => tryTakeLock);
    }

    const heldSince = Number(observed.value);

    if (Number.isNaN(heldSince) || now - heldSince > Duration.toMillis(options.staleAfter)) {
      yield* removeStaleLock(observed.value);

      return yield* Effect.suspend(() => tryTakeLock);
    }

    return Option.none();
  });

  /** Tries to take the lock at each retry interval until it holds the time of this process. */
  const waitForLock: Effect.Effect<number, CacheError> = Effect.flatMap(
    tryTakeLock,
    Option.match({
      onSome: Effect.succeed,
      onNone: () =>
        Effect.andThen(
          Effect.sleep(retryInterval),
          Effect.suspend(() => waitForLock),
        ),
    }),
  );

  const takeLock = waitForLock.pipe(
    Effect.timeoutOrElse({
      duration: options.wait,
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
    const interval = renewalInterval(options.staleAfter);

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
      owns ? Effect.ignore(fs.remove(lockFile, { force: true })) : Effect.void,
    );

  const lock: Lock = {
    around: (effect) =>
      Effect.acquireUseRelease(
        Effect.flatMap(takeLock, (time) => Ref.make(time)),
        (owned) => Effect.raceFirst(effect, Effect.andThen(renewLock(owned), Effect.never)),
        releaseLock,
      ),
  };

  return lock;
});
