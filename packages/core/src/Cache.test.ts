import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import * as Cache from "./Cache.ts";

const record = (secret: string): Cache.CacheRecord => ({
  provider: "memory",
  reference: "memory://a",
  value: Redacted.make(secret),
  resolvedAt: 1000,
});

describe("Cache.layerMemory", () => {
  it.effect("returns only the keys that it holds", () =>
    Effect.gen(function* () {
      const cache = yield* Cache.Cache;

      yield* cache.setMany({ a: record("1"), b: record("2") });

      const found = yield* cache.getMany(["a", "missing"]);

      expect(Object.keys(found)).toEqual(["a"]);
      expect(Redacted.value(found["a"]?.value ?? Redacted.make(""))).toBe("1");
    }).pipe(Effect.provide(Cache.layerMemory)),
  );

  it.effect("removes keys, lists entries, and clears", () =>
    Effect.gen(function* () {
      const cache = yield* Cache.Cache;

      yield* cache.setMany({ a: record("1"), b: record("2"), c: record("3") });
      yield* cache.removeMany(["a"]);

      expect((yield* cache.list()).map((entry) => entry.key)).toEqual(["b", "c"]);
      expect(yield* cache.clear()).toBe(2);
      expect(yield* cache.list()).toEqual([]);
    }).pipe(Effect.provide(Cache.layerMemory)),
  );

  it("never shows a secret when a record is printed", () => {
    expect(JSON.stringify(record("hunter2"))).not.toContain("hunter2");
  });
});

describe("Cache.layerNone", () => {
  it.effect("stores nothing", () =>
    Effect.gen(function* () {
      const cache = yield* Cache.Cache;

      yield* cache.setMany({ a: record("1") });

      expect(yield* cache.getMany(["a"])).toEqual({});
    }).pipe(Effect.provide(Cache.layerNone)),
  );
});
