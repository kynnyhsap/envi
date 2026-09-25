import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";

import * as Cache from "./Cache.ts";
import { CacheError, CacheFailure } from "./Errors.ts";
import * as FileCache from "./FileCache.ts";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const keyA = Redacted.make(new Uint8Array(32).fill(1));

const keyB = Redacted.make(new Uint8Array(32).fill(2));

const record = (value: string, resolvedAt = 1000): Cache.CacheRecord => ({
  provider: "memory",
  reference: "memory://token",
  value: Option.some(Redacted.make(value)),
  resolvedAt,
});

/** Runs one effect against a new instance of the file cache, as a new process does. */
const withCache = <A, E>(
  directory: string,
  effect: Effect.Effect<A, E, Cache.Cache>,
  key: Redacted.Redacted<Uint8Array> = keyA,
) =>
  effect.pipe(
    Effect.provide(
      FileCache.layer({ directory, lockWait: "5 seconds", lockStaleAfter: "1 minute" }),
    ),
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
        Effect.flatMap(Cache.Cache, (cache) => cache.setMany({ "memory:token": record("s3cret") })),
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
    }).pipe(Effect.provide(platform)),
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
        Effect.flatMap(Cache.Cache, (cache) => cache.setMany({ "memory:a": record("value-a") })),
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
        Effect.flatMap(Cache.Cache, (cache) => cache.setMany({ "memory:b": record("value-b") })),
      );

      const files = yield* entryFiles(directory);
      const other = files.find((name) => name !== file) ?? "";

      yield* fs.writeFileString(other, original);

      const found = yield* read();

      expect(Object.keys(found)).toEqual(["memory:a"]);
    }).pipe(Effect.provide(platform)),
  );

  it.effect("keeps a record without a value, and binds the missing value to the entry", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* tempDirectory;
      const missing: Cache.CacheRecord = { ...record(""), value: Option.none() };

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
    }).pipe(Effect.provide(platform)),
  );

  it.effect("writes plaintext only with the explicit opt-in", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* tempDirectory;
      const plain = FileCache.layerPlaintext({ directory });

      yield* Effect.flatMap(Cache.Cache, (cache) =>
        cache.setMany({ "memory:token": record("visible") }),
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
    }).pipe(Effect.provide(platform)),
  );

  it.effect("lists, removes, and clears entries, and reports the directory", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory;

      yield* withCache(
        directory,
        Effect.gen(function* () {
          const cache = yield* Cache.Cache;

          expect(cache.directory).toEqual(Option.some(directory));
          expect(yield* cache.list()).toEqual([]);
          expect(yield* cache.clear()).toBe(0);

          yield* cache.setMany({
            "memory:a": record("a", 1),
            "memory:b": record("b", 2),
            "memory:c": record("c", 3),
          });

          yield* cache.removeMany(["memory:b", "memory:missing"]);

          const entries = yield* cache.list();

          expect(entries.map((entry) => entry.key).toSorted()).toEqual(["memory:a", "memory:c"]);
          expect(JSON.stringify(entries)).not.toContain('"value"');
          expect(yield* cache.clear()).toBe(2);
          expect(yield* cache.list()).toEqual([]);
        }),
      );
    }).pipe(Effect.provide(platform)),
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
    }).pipe(Effect.provide(platform)),
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
    }).pipe(Effect.provide(platform)),
  );

  it.effect("takes over the lock of a crashed owner", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* tempDirectory;

      // The lock of an owner that crashed at the time 0 and never released it.
      yield* fs.writeFileString(`${directory}/${FileCache.lockFileName}`, "0");
      yield* TestClock.setTime(120_000);

      const result = yield* withCache(
        directory,
        Effect.flatMap(Cache.Cache, (cache) => cache.withResolveLock(Effect.succeed("ran"))),
      );

      expect(result).toBe("ran");
      expect(yield* fs.exists(`${directory}/${FileCache.lockFileName}`)).toBe(false);
    }).pipe(Effect.provide(platform)),
  );
});
