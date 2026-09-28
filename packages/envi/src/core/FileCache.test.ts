import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";

import * as Cache from "./Cache.ts";
import * as CacheLock from "./CacheLock.ts";
import { CacheError, CacheFailure } from "./Errors.ts";
import * as FileCache from "./FileCache.ts";
import { cacheRecord, nodePlatform } from "./fixtures/Support.ts";

const keyA = Redacted.make(new Uint8Array(32).fill(1));

const keyB = Redacted.make(new Uint8Array(32).fill(2));

/** Runs one effect against a new instance of the file cache, as a new process does. */
const withCache = <A, E>(
  directory: string,
  effect: Effect.Effect<A, E, Cache.Cache>,
  key: Redacted.Redacted<Uint8Array> = keyA,
  lockStaleAfter: Duration.Input = "1 minute",
) =>
  effect.pipe(
    Effect.provide(FileCache.layer({ directory, lockWait: "5 seconds", lockStaleAfter })),
    Effect.provide(FileCache.layerEncryptionKey(key)),
  );

/** Waits for a fiber. It moves the test clock while the fiber does real file I/O between sleeps. */
const joinWithClock = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Effect.raceFirst(
    Fiber.join(fiber),
    Effect.forever(
      Effect.andThen(TestClock.adjust("1 second"), TestClock.withLive(Effect.sleep("5 millis"))),
    ),
  );

const valueOf = (records: Cache.CacheRecords, key: string): string | undefined =>
  Option.getOrUndefined(
    Option.flatMap(Option.fromUndefinedOr(records[key]), (found) =>
      Option.map(found.value, Redacted.value),
    ),
  );

const tempDirectory = Effect.flatMap(FileSystem.FileSystem, (fs) =>
  fs.makeTempDirectoryScoped({ prefix: "envi-cache-test-" }),
);

const entryFiles = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const names = yield* fs.readDirectory(directory);

    return names.filter((name) => name.endsWith(".json")).map((name) => path.join(directory, name));
  });

describe("FileCache", () => {
  it.effect("keeps a record across instances and encrypts the file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = `${yield* tempDirectory}/nested/cache`;

      yield* withCache(
        directory,
        Effect.flatMap(Cache.Cache, (cache) =>
          cache.setMany({ "memory:token": cacheRecord("s3cret") }),
        ),
      );

      const found = yield* withCache(
        directory,
        Effect.flatMap(Cache.Cache, (cache) => cache.getMany(["memory:token", "memory:other"])),
      );

      expect(Object.keys(found)).toEqual(["memory:token"]);
      expect(valueOf(found, "memory:token")).toBe("s3cret");
      expect(found["memory:token"]).toMatchObject({
        provider: "memory",
        reference: "memory://token",
        resolvedAt: 1000,
      });

      const files = yield* entryFiles(directory);
      const [file] = files;

      expect(files.length).toBe(1);
      expect(yield* fs.readFileString(file ?? "")).not.toContain("s3cret");
      expect((yield* fs.stat(file ?? "")).mode & 0o777).toBe(0o600);
      expect((yield* fs.stat(directory)).mode & 0o777).toBe(0o700);
    }).pipe(Effect.provide(nodePlatform)),
  );

  it.effect("treats an entry with another key, a moved entry, and an edited entry as a miss", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* tempDirectory;

      const read = (key?: Redacted.Redacted<Uint8Array>) =>
        withCache(
          directory,
          Effect.flatMap(Cache.Cache, (cache) => cache.getMany(["memory:a", "memory:b"])),
          key,
        );

      yield* withCache(
        directory,
        Effect.flatMap(Cache.Cache, (cache) =>
          cache.setMany({ "memory:a": cacheRecord("value-a") }),
        ),
      );

      expect(Object.keys(yield* read(keyB))).toEqual([]);

      const [file] = yield* entryFiles(directory);
      const original = yield* fs.readFileString(file ?? "");

      // An edit of the freshness metadata breaks the integrity check.
      yield* fs.writeFileString(file ?? "", original.replace("1000", "9999"));
      expect(Object.keys(yield* read())).toEqual([]);

      yield* fs.writeFileString(file ?? "", "not json");
      expect(Object.keys(yield* read())).toEqual([]);

      // A valid entry under the file name of another cache key does not decrypt.
      yield* fs.writeFileString(file ?? "", original);

      yield* withCache(
        directory,
        Effect.flatMap(Cache.Cache, (cache) =>
          cache.setMany({ "memory:b": cacheRecord("value-b") }),
        ),
      );

      const files = yield* entryFiles(directory);
      const other = files.find((name) => name !== file) ?? "";

      yield* fs.writeFileString(other, original);

      const found = yield* read();

      expect(Object.keys(found)).toEqual(["memory:a"]);
    }).pipe(Effect.provide(nodePlatform)),
  );

  it.effect("keeps a record without a value, and binds the missing value to the entry", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* tempDirectory;
      const missing: Cache.CacheRecord = { ...cacheRecord(""), value: Option.none() };

      const read = withCache(
        directory,
        Effect.flatMap(Cache.Cache, (cache) => cache.getMany(["memory:a"])),
      );

      yield* withCache(
        directory,
        Effect.flatMap(Cache.Cache, (cache) => cache.setMany({ "memory:a": missing })),
      );

      expect((yield* read)["memory:a"]?.value).toEqual(Option.none());

      // Flipping the flag would turn a missing value into an empty string. The check fails.
      const [file] = yield* entryFiles(directory);
      const original = yield* fs.readFileString(file ?? "");

      yield* fs.writeFileString(file ?? "", original.replace('"found":false', '"found":true'));
      expect(Object.keys(yield* read)).toEqual([]);

      const plain = FileCache.layerPlaintext({ directory });

      const fromPlain = yield* Effect.flatMap(Cache.Cache, (cache) =>
        Effect.andThen(cache.setMany({ "memory:a": missing }), cache.getMany(["memory:a"])),
      ).pipe(Effect.provide(plain));

      expect(fromPlain["memory:a"]?.value).toEqual(Option.none());
    }).pipe(Effect.provide(nodePlatform)),
  );

  it.effect("writes plaintext only with the explicit opt-in", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* tempDirectory;
      const plain = FileCache.layerPlaintext({ directory });

      yield* Effect.flatMap(Cache.Cache, (cache) =>
        cache.setMany({ "memory:token": cacheRecord("visible") }),
      ).pipe(Effect.provide(plain));

      const [file] = yield* entryFiles(directory);

      const found = yield* Effect.flatMap(Cache.Cache, (cache) =>
        cache.getMany(["memory:token"]),
      ).pipe(Effect.provide(plain));

      expect(yield* fs.readFileString(file ?? "")).toContain("visible");
      expect((yield* fs.stat(file ?? "")).mode & 0o777).toBe(0o600);
      expect(valueOf(found, "memory:token")).toBe("visible");

      // An encrypted cache does not read a plaintext entry.
      const encrypted = yield* withCache(
        directory,
        Effect.flatMap(Cache.Cache, (cache) => cache.getMany(["memory:token"])),
      );

      expect(Object.keys(encrypted)).toEqual([]);
    }).pipe(Effect.provide(nodePlatform)),
  );

  it.effect("lists and clears entries", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory;

      yield* withCache(
        directory,
        Effect.gen(function* () {
          const cache = yield* Cache.Cache;

          expect(yield* cache.list()).toEqual([]);
          expect(yield* cache.clear()).toBe(0);

          yield* cache.setMany({
            "memory:a": cacheRecord("a", 1),
            "memory:b": cacheRecord("b", 2),
          });

          const entries = yield* cache.list();

          expect(entries.map((entry) => entry.key).toSorted()).toEqual(["memory:a", "memory:b"]);
          expect(JSON.stringify(entries)).not.toContain('"value"');
          expect(yield* cache.clear()).toBe(2);
          expect(yield* cache.list()).toEqual([]);
        }),
      );
    }).pipe(Effect.provide(nodePlatform)),
  );

  it.effect("runs one locked resolution at a time", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory;
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const order: Array<string> = [];

      const first = yield* Effect.forkChild(
        withCache(
          directory,
          Effect.flatMap(Cache.Cache, (cache) =>
            cache.withResolveLock(
              Effect.gen(function* () {
                order.push("first in");
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(release);
                order.push("first out");
              }),
            ),
          ),
        ),
      );

      yield* Deferred.await(entered);

      const second = yield* Effect.forkChild(
        withCache(
          directory,
          Effect.flatMap(Cache.Cache, (cache) =>
            cache.withResolveLock(Effect.sync(() => order.push("second"))),
          ),
        ),
      );

      yield* TestClock.withLive(Effect.sleep("50 millis"));
      yield* TestClock.adjust("1 second");
      yield* TestClock.withLive(Effect.sleep("50 millis"));
      expect(order).toEqual(["first in"]);

      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(first);
      yield* joinWithClock(second);

      expect(order).toEqual(["first in", "first out", "second"]);
    }).pipe(Effect.provide(nodePlatform)),
  );

  it.effect("fails with LockTimeout after the bounded wait", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory;
      const entered = yield* Deferred.make<void>();

      yield* Effect.forkChild(
        withCache(
          directory,
          Effect.flatMap(Cache.Cache, (cache) =>
            cache.withResolveLock(
              Effect.andThen(Deferred.succeed(entered, undefined), Effect.never),
            ),
          ),
        ),
      );

      yield* Deferred.await(entered);

      const waiting = yield* Effect.forkChild(
        Effect.flip(
          withCache(
            directory,
            Effect.flatMap(Cache.Cache, (cache) => cache.withResolveLock(Effect.void)),
          ),
        ),
      );

      const error = yield* joinWithClock(waiting);

      expect(error).toBeInstanceOf(CacheError);
      expect(error).toMatchObject({ reason: CacheFailure.LockTimeout });
    }).pipe(Effect.provide(nodePlatform)),
  );

  it.effect("takes over the lock of a crashed owner", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* tempDirectory;

      // The lock of an owner that crashed at the time 0 and never released it.
      yield* fs.writeFileString(`${directory}/${CacheLock.lockFileName}`, "0");
      yield* TestClock.setTime(120_000);

      const result = yield* withCache(
        directory,
        Effect.flatMap(Cache.Cache, (cache) => cache.withResolveLock(Effect.succeed("ran"))),
      );

      expect(result).toBe("ran");
      expect(yield* fs.exists(`${directory}/${CacheLock.lockFileName}`)).toBe(false);
    }).pipe(Effect.provide(nodePlatform)),
  );

  it.live("removes its lock after an effect that ends at once", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* tempDirectory;

      for (let run = 0; run < 20; run += 1) {
        yield* withCache(
          directory,
          Effect.flatMap(Cache.Cache, (cache) => cache.withResolveLock(Effect.void)),
        );

        expect(yield* fs.exists(`${directory}/${CacheLock.lockFileName}`)).toBe(false);
      }
    }).pipe(Effect.provide(nodePlatform)),
  );

  it.effect("leaves the lock of another owner at release", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* tempDirectory;
      const lockFile = `${directory}/${CacheLock.lockFileName}`;

      // Another process stole the lock while this one ran, and wrote its own time.
      yield* withCache(
        directory,
        Effect.flatMap(Cache.Cache, (cache) =>
          cache.withResolveLock(fs.writeFileString(lockFile, "424242")),
        ),
      );

      expect(yield* fs.readFileString(lockFile)).toBe("424242");
    }).pipe(Effect.provide(nodePlatform)),
  );

  it.effect("renews its lock past the stale age, so no other process takes it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* tempDirectory;
      const lockFile = `${directory}/${CacheLock.lockFileName}`;
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const staleAfter = Duration.seconds(3);

      const owner = yield* Effect.forkChild(
        withCache(
          directory,
          Effect.flatMap(Cache.Cache, (cache) =>
            cache.withResolveLock(
              Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)),
            ),
          ),
          keyA,
          staleAfter,
        ),
      );

      yield* Deferred.await(entered);

      // Each renewal writes the time of the test clock. The loop moves the clock until the owner
      // has renewed its lock past the stale age. When the owner never renews, the test times out.
      const renewedAt = yield* Effect.repeat(
        TestClock.adjust("1 second").pipe(
          Effect.andThen(TestClock.withLive(Effect.sleep("5 millis"))),
          Effect.andThen(Effect.map(fs.readFileString(lockFile), Number)),
        ),
        { until: (time) => time > Duration.toMillis(staleAfter) },
      );

      expect(renewedAt).toBeGreaterThan(Duration.toMillis(staleAfter));

      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(owner);
    }).pipe(Effect.provide(nodePlatform)),
  );

  it.effect("renews only a lock that still holds its own time", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* tempDirectory;
      const lockFile = `${directory}/${CacheLock.lockFileName}`;
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();

      const owner = yield* Effect.forkChild(
        withCache(
          directory,
          Effect.flatMap(Cache.Cache, (cache) =>
            cache.withResolveLock(
              Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)),
            ),
          ),
          keyA,
          "3 seconds",
        ),
      );

      yield* Deferred.await(entered);
      yield* fs.writeFileString(lockFile, "424242");

      for (let tick = 0; tick < 5; tick++) {
        yield* TestClock.adjust("1 second");
        yield* TestClock.withLive(Effect.sleep("20 millis"));
      }

      expect(yield* fs.readFileString(lockFile)).toBe("424242");

      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(owner);
    }).pipe(Effect.provide(nodePlatform)),
  );

  it.effect("removes leftover temp files on clear and counts only entries", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* tempDirectory;
      const temp = `${directory}/0123.json.abcdef.tmp`;

      const removed = yield* withCache(
        directory,
        Effect.gen(function* () {
          const cache = yield* Cache.Cache;

          yield* cache.setMany({ "memory:a": cacheRecord("a") });
          yield* fs.writeFileString(temp, "partial");

          return yield* cache.clear();
        }),
      );

      expect(removed).toBe(1);
      expect(yield* fs.exists(temp)).toBe(false);
    }).pipe(Effect.provide(nodePlatform)),
  );
});
