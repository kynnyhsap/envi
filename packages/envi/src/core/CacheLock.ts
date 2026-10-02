// The resolve lock of the file cache. It runs one resolution at a time across processes, also
// across worktrees that run different Envi versions against one cache directory. The exclusion is
// best effort: in two rare races, two processes hold the lock and both call a provider. An owner
// that misses its renewals past the stale age, such as in a laptop sleep, loses the lock while it
// still runs. The takeover of a stale lock has a race, see `removeStaleLock`. The cache stays
// consistent, because each entry write is atomic.
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

/** The lock file of one cache directory, and what its operations need. */
interface LockFile {
  readonly fs: FileSystem.FileSystem;
  readonly file: string;
  readonly options: Options;
}

const writeLockTemp = (lock: LockFile, now: number) => {
  const temp = `${lock.file}.${crypto.randomUUID()}`;

  return Effect.as(lock.fs.writeFileString(temp, String(now), { flag: "wx", mode: 0o600 }), temp);
};

/** The text of the lock file. None when the lock file is missing or does not read. */
const lockText = (lock: LockFile) => Effect.option(lock.fs.readFileString(lock.file));

/**
 * Removes a stale lock. The rename to a unique name is atomic, so only one process moves the
 * file. When the moved file holds another text, another process took the lock after the read:
 * the link tries to put its lock back.
 *
 * The read and the rename are two steps, not one compare-and-swap, so three contenders can race.
 * B reads a stale lock. A replaces it with a fresh lock of its own. B moves the lock of A away,
 * and C takes the empty path before B links the lock of A back. The link fails, and A and C both
 * hold the lock. A stops its renewals and leaves the lock of C at release. A fix needs a new lock
 * protocol, and so a new lock file name.
 */
const removeStaleLock = (lock: LockFile, observed: string) =>
  Effect.gen(function* () {
    const moved = `${lock.file}.${crypto.randomUUID()}.stale`;

    const renamed = yield* lock.fs.rename(lock.file, moved).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );

    if (!renamed) {
      return;
    }

    const text = yield* Effect.orElseSucceed(lock.fs.readFileString(moved), () => observed);

    if (text !== observed) {
      yield* Effect.ignore(lock.fs.link(moved, lock.file));
    }

    yield* Effect.ignore(lock.fs.remove(moved, { force: true }));
  });

/** Takes the lock once. Some holds the time that this process wrote into the lock file. */
const tryTakeLock = (lock: LockFile): Effect.Effect<Option.Option<number>, CacheError> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;

    // A lock file always holds a complete time: Envi writes a temp file and links it. A reader
    // never sees a lock file that is empty or half written.
    const taken = yield* Effect.acquireUseRelease(
      writeLockTemp(lock, now),
      (temp) =>
        lock.fs.link(temp, lock.file).pipe(
          Effect.as(true),
          Effect.catchIf(
            (error) => Predicate.isTagged(error.reason, "AlreadyExists"),
            () => Effect.succeed(false),
          ),
        ),
      (temp) => Effect.ignore(lock.fs.remove(temp, { force: true })),
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
    const observed = yield* lockText(lock);

    if (Option.isNone(observed)) {
      return yield* tryTakeLock(lock);
    }

    const heldSince = Number(observed.value);

    if (Number.isNaN(heldSince) || now - heldSince > Duration.toMillis(lock.options.staleAfter)) {
      yield* removeStaleLock(lock, observed.value);

      return yield* tryTakeLock(lock);
    }

    return Option.none();
  });

/** Tries to take the lock at each retry interval until it holds the time of this process. */
const waitForLock = (lock: LockFile): Effect.Effect<number, CacheError> =>
  Effect.flatMap(
    tryTakeLock(lock),
    Option.match({
      onSome: Effect.succeed,
      onNone: () => Effect.andThen(Effect.sleep(retryInterval), waitForLock(lock)),
    }),
  );

const takeLock = (lock: LockFile) =>
  waitForLock(lock).pipe(
    Effect.timeoutOrElse({
      duration: lock.options.wait,
      orElse: () =>
        Effect.fail(
          new CacheError({
            reason: CacheFailure.LockTimeout,
            detail: `Another Envi process holds ${lock.file}. Remove the file if no Envi process runs.`,
          }),
        ),
    }),
  );

/** `true` while the lock file holds the time that this process wrote last. */
const ownsLock = (lock: LockFile, owned: Ref.Ref<number>) =>
  Effect.map(Effect.all([lockText(lock), Ref.get(owned)]), ([text, time]) =>
    Option.contains(text, String(time)),
  );

/**
 * The owner renews the time in the lock file, so a long provider prompt does not look crashed.
 * It renews only its own lock: after a steal, the lock belongs to the other process. One renewal
 * is uninterruptible, so the lock file and `owned` always hold the same time for the release.
 */
const renewLock = (lock: LockFile, owned: Ref.Ref<number>) => {
  const renew = Effect.gen(function* () {
    if (!(yield* ownsLock(lock, owned))) {
      return;
    }

    const now = yield* Clock.currentTimeMillis;

    yield* Effect.acquireUseRelease(
      writeLockTemp(lock, now),
      (temp) => lock.fs.rename(temp, lock.file),
      (temp) => Effect.ignore(lock.fs.remove(temp, { force: true })),
    );

    yield* Ref.set(owned, now);
  }).pipe(Effect.ignore, Effect.uninterruptible);

  return Effect.andThen(Effect.sleep(renewalInterval(lock.options.staleAfter)), renew).pipe(
    Effect.repeat(Schedule.forever),
  );
};

/** Removes the lock only while it holds the time of this process. */
const releaseLock = (lock: LockFile, owned: Ref.Ref<number>) =>
  Effect.flatMap(ownsLock(lock, owned), (owns) =>
    owns ? Effect.ignore(lock.fs.remove(lock.file, { force: true })) : Effect.void,
  );

export const make = Effect.fn("CacheLock.make")(function* (options: Options) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lock: LockFile = { fs, file: path.join(options.directory, lockFileName), options };

  const around: Lock["around"] = (effect) =>
    Effect.acquireUseRelease(
      Effect.flatMap(takeLock(lock), (time) => Ref.make(time)),
      (owned) => Effect.raceFirst(effect, Effect.andThen(renewLock(lock, owned), Effect.never)),
      (owned) => releaseLock(lock, owned),
    );

  return { around } satisfies Lock;
});
