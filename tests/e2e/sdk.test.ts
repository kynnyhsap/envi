// The SDK on real files: a custom provider, a custom cache, the encrypted file cache with a
// fixed key, and the plain client.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import {
  Cache,
  CacheError,
  CacheFailure,
  createEnvi,
  defineConfig,
  Envi,
  FileCache,
  ValueOrigin,
} from "envi";

import { fileProvider } from "./fixtures/file-provider.ts";
import { cacheFiles, makeSandbox, providerCalls, type Sandbox, secrets } from "./helpers.ts";

const config = defineConfig({
  providers: [fileProvider],
  vars: ({ file }) => ({
    API_TOKEN: file("token-development"),
    PUBLIC_NAME: file("public-name").redact(false),
  }),
});

/** The file provider reads its paths from the environment of this process. */
const useSandbox = (sandbox: Sandbox) =>
  Effect.sync(() => {
    Object.assign(process.env, sandbox.env);
  });

const StoredRecords = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Struct({
      provider: Schema.String,
      reference: Schema.String,
      value: Schema.String,
      resolvedAt: Schema.Number,
    }),
  ),
);

const unreadable = () =>
  new CacheError({ reason: CacheFailure.Unreadable, detail: "The cache file does not read." });

/**
 * A custom cache that a user could write: every record in one JSON file. It implements the
 * public `Cache` interface and nothing else.
 */
const singleFileCache = (file: string): Layer.Layer<Cache.Cache, never, FileSystem.FileSystem> =>
  Layer.effect(
    Cache.Cache,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const read = fs.readFileString(file).pipe(
        Effect.flatMap(Schema.decodeEffect(StoredRecords)),
        Effect.orElseSucceed((): typeof StoredRecords.Type => ({})),
      );

      const write = (records: typeof StoredRecords.Type) =>
        Schema.encodeEffect(StoredRecords)(records).pipe(
          Effect.flatMap((text) => fs.writeFileString(file, text)),
          Effect.mapError(unreadable),
        );

      return Cache.Cache.of({
        getMany: (keys) =>
          Effect.map(read, (records) =>
            Object.fromEntries(
              keys.flatMap((key) => {
                const found = records[key];

                return found === undefined
                  ? []
                  : [[key, { ...found, value: Redacted.make(found.value) }]];
              }),
            ),
          ),
        setMany: (records) =>
          Effect.flatMap(read, (current) =>
            write({
              ...current,
              ...Object.fromEntries(
                Object.entries(records).map(([key, record]) => [
                  key,
                  { ...record, value: Redacted.value(record.value) },
                ]),
              ),
            }),
          ),
        removeMany: (keys) =>
          Effect.flatMap(read, (current) =>
            write(
              Object.fromEntries(Object.entries(current).filter(([key]) => !keys.includes(key))),
            ),
          ),
        list: () =>
          Effect.map(read, (records) =>
            Object.entries(records).map(([key, record]) => ({
              key,
              provider: record.provider,
              reference: record.reference,
              resolvedAt: record.resolvedAt,
            })),
          ),
        clear: () =>
          Effect.flatMap(read, (current) => Effect.as(write({}), Object.keys(current).length)),
        withResolveLock: (effect) => effect,
        directory: Option.none(),
      });
    }),
  );

const keyOf = (byte: number) => Redacted.make(new Uint8Array(32).fill(byte));

const originsOf = (report: { readonly vars: ReadonlyArray<{ key: string; origin: string }> }) =>
  Object.fromEntries(report.vars.map((entry) => [entry.key, entry.origin]));

layer(NodeServices.layer, { excludeTestServices: true })("envi SDK on real files", (it) => {
  describe("the Effect API", () => {
    it.effect("resolves through a custom provider and a custom cache", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sandbox = yield* makeSandbox("none");
        const cacheFile = path.join(sandbox.directory, "custom-cache.json");

        yield* useSandbox(sandbox);

        const program = Effect.gen(function* () {
          const envi = yield* Envi.Envi;
          const env = yield* envi.load(config);
          const report = yield* envi.inspect(config);
          const list = yield* envi.cache.list;

          return { env, origins: originsOf(report), references: list.entries.length };
        }).pipe(Effect.provide(Layer.provide(Envi.layer(), singleFileCache(cacheFile))));

        const result = yield* program;

        expect(result.env).toEqual({
          API_TOKEN: secrets["token-development"],
          PUBLIC_NAME: secrets["public-name"],
        });
        expect(result.origins).toEqual({
          API_TOKEN: ValueOrigin.Cache,
          PUBLIC_NAME: ValueOrigin.Cache,
        });
        expect(result.references).toBe(2);
        expect(yield* providerCalls(sandbox)).toEqual([["public-name", "token-development"]]);
        expect(yield* fs.readFileString(cacheFile)).toContain("file://token-development");
      }),
    );

    it.effect("encrypts each entry, and another key reads nothing", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");

        yield* useSandbox(sandbox);

        const loadWith = (key: Redacted.Redacted<Uint8Array>) =>
          Envi.Envi.use((envi) => envi.load(config)).pipe(
            Effect.provide(
              Envi.layer().pipe(
                Layer.provide(FileCache.layer({ directory: sandbox.cacheDirectory })),
                Layer.provide(FileCache.layerEncryptionKey(key)),
              ),
            ),
          );

        yield* loadWith(keyOf(1));
        yield* loadWith(keyOf(1));

        const files = yield* cacheFiles(sandbox.cacheDirectory);

        expect((yield* providerCalls(sandbox)).length).toBe(1);
        expect(files.length).toBe(2);
        expect(files.every((entry) => entry.encryption === "aes-256-gcm")).toBe(true);
        expect(files.map((entry) => entry.text).join()).not.toContain(secrets["token-development"]);

        // The entries of the first key do not decrypt. They count as misses, and Envi replaces them.
        const env = yield* loadWith(keyOf(2));

        expect(env.API_TOKEN).toBe(secrets["token-development"]);
        expect((yield* providerCalls(sandbox)).length).toBe(2);

        yield* loadWith(keyOf(2));

        expect((yield* providerCalls(sandbox)).length).toBe(2);
      }),
    );
  });

  describe("the plain client", () => {
    it.effect("uses the file cache of its config and clears it", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");

        yield* useSandbox(sandbox);

        const envi = createEnvi(config, {
          cache: { directory: sandbox.cacheDirectory, encryption: "none" },
        });

        yield* Effect.acquireRelease(Effect.void, () => Effect.promise(() => envi.dispose()));

        const env = yield* Effect.promise(() => envi.load());
        const raw = yield* Effect.promise(() => envi.loadRaw());
        const path = yield* Effect.promise(() => envi.cache.path());
        const cleared = yield* Effect.promise(() => envi.cache.clear());

        expect(env.API_TOKEN).toBe(secrets["token-development"]);
        expect(raw).toEqual(env);
        expect(path).toBe(sandbox.cacheDirectory);
        expect((yield* providerCalls(sandbox)).length).toBe(1);
        expect(cleared.removed).toBe(2);
        expect(yield* cacheFiles(sandbox.cacheDirectory)).toEqual([]);
      }),
    );
  });
});
