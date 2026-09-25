import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";

import type { CacheError } from "./Errors.ts";

/** One cached secret. Encryption is private to the file layer and never appears here. */
export interface CacheRecord {
  readonly provider: string;
  /** The `describe()` text of the reference. `cache list` shows it. */
  readonly reference: string;
  /**
   * The value, or nothing when the provider reported `NotFound`. Envi serves a record without a
   * value only to a var that allows a missing value, with `.optional()` or `.default()`.
   */
  readonly value: Option.Option<Redacted.Redacted>;
  /** Epoch milliseconds. */
  readonly resolvedAt: number;
}

/** One entry of `cache list`. It holds no value. */
export interface CacheEntry {
  readonly key: string;
  readonly provider: string;
  readonly reference: string;
  readonly resolvedAt: number;
}

/** The records of one cache call, by cache key. */
export type CacheRecords = Readonly<Record<string, CacheRecord>>;

/** The logical cache: values plus freshness. Unstable until a second real cache proves it. */
export interface Interface {
  /** Returns the records that exist. A missing or a corrupt entry is absent from the result. */
  readonly getMany: (keys: ReadonlyArray<string>) => Effect.Effect<CacheRecords, CacheError>;
  readonly setMany: (records: CacheRecords) => Effect.Effect<void, CacheError>;
  readonly removeMany: (keys: ReadonlyArray<string>) => Effect.Effect<void, CacheError>;
  readonly list: () => Effect.Effect<ReadonlyArray<CacheEntry>, CacheError>;
  /** Removes every entry. Returns the number of removed entries. */
  readonly clear: () => Effect.Effect<number, CacheError>;
  /** Runs one resolution at a time across processes. A layer without files runs it directly. */
  readonly withResolveLock: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | CacheError, R>;
  /** The directory of a file cache. */
  readonly directory: Option.Option<string>;
}

/** The service tag of the cache. */
export class Cache extends Context.Service<Cache, Interface>()("envi/Cache") {}

/** A cache in the memory of one process. Tests and short-lived SDK clients use it. */
export const layerMemory: Layer.Layer<Cache> = Layer.effect(
  Cache,
  Effect.gen(function* () {
    const store = yield* Ref.make<CacheRecords>({});

    return Cache.of({
      getMany: (keys) =>
        Effect.map(Ref.get(store), (records) =>
          Object.fromEntries(
            keys.flatMap((key) => {
              const found = records[key];

              return found === undefined ? [] : [[key, found]];
            }),
          ),
        ),
      setMany: (records) => Ref.update(store, (current) => ({ ...current, ...records })),
      removeMany: (keys) =>
        Ref.update(store, (current) =>
          Object.fromEntries(Object.entries(current).filter(([key]) => !keys.includes(key))),
        ),
      list: () =>
        Effect.map(Ref.get(store), (records) =>
          Object.entries(records).map(([key, found]) => ({
            key,
            provider: found.provider,
            reference: found.reference,
            resolvedAt: found.resolvedAt,
          })),
        ),
      clear: () => Effect.map(Ref.getAndSet(store, {}), (records) => Object.keys(records).length),
      withResolveLock: (effect) => effect,
      directory: Option.none(),
    });
  }),
);

/** A disabled cache. CI uses it by default. */
export const layerNone: Layer.Layer<Cache> = Layer.succeed(
  Cache,
  Cache.of({
    getMany: () => Effect.succeed({}),
    setMany: () => Effect.void,
    removeMany: () => Effect.void,
    list: () => Effect.succeed([]),
    clear: () => Effect.succeed(0),
    withResolveLock: (effect) => effect,
    directory: Option.none(),
  }),
);
