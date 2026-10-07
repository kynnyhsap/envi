import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { defineConfig } from "./Config.ts";
import * as Envi from "./Envi.ts";
import { ProviderError, ProviderFailure } from "./Errors.ts";
import { enviLayer, withEnv } from "./fixtures/Support.ts";
import { memoryProvider } from "./Memory.ts";
import * as Provider from "./Provider.ts";

const secrets = {
  "stripe/secret-key": "sk_fake",
  "stripe/publishable-key": "pk_fake",
  "postgres/url": "postgres://fake",
};

/** A provider that searches a fixed list of names, and records the queries and the context of each search. */
const searching = (names: ReadonlyArray<string>) => {
  const searches: Array<{
    readonly queries: ReadonlyArray<string>;
    readonly interactive: boolean;
  }> = [];

  const provider = Provider.make({
    id: "search",
    scope: "search",
    resolveMany: (requests) =>
      Effect.succeed(
        Object.fromEntries(requests.map((request) => [request.key, Result.succeed("value")])),
      ),
    discover: (queries, context) =>
      Effect.sync(() => {
        searches.push({ queries, interactive: context.interactive });

        return Object.fromEntries(
          queries.map((query) => [query, names.filter((name) => name.includes(query))]),
        );
      }),
    helpers: {},
  });

  return { provider, searches };
};

/** A provider without `discover`. */
const plain = Provider.make({
  id: "plain",
  scope: "plain",
  resolveMany: (requests) =>
    Effect.succeed(
      Object.fromEntries(requests.map((request) => [request.key, Result.succeed("value")])),
    ),
  helpers: {},
});

const find = (config: Parameters<Envi.Interface["find"]>[0], queries: ReadonlyArray<string>) =>
  Effect.flatMap(Envi.Envi, (envi) => envi.find(config, queries));

describe("Envi.find", () => {
  it.effect("lists the references of each query and reads no value", () =>
    Effect.gen(function* () {
      const memory = memoryProvider(secrets);
      const config = defineConfig({ providers: [memory], vars: {} });
      const report = yield* find(config, ["stripe", "redis"]);

      expect(report).toEqual({
        queries: [
          {
            query: "stripe",
            references: Object.keys(secrets)
              .filter((key) => key.includes("stripe"))
              .map((key) => ({ provider: memory.id, reference: `${memory.id}://${key}` })),
          },
          { query: "redis", references: [] },
        ],
        skipped: [],
      });

      expect(memory.calls()).toEqual([]);
    }).pipe(Effect.provide(enviLayer())),
  );

  it.effect(
    "searches each provider once for every query, and skips a provider without search",
    () =>
      Effect.gen(function* () {
        const { provider, searches } = searching(["app/stripe", "payments/stripe"]);
        const config = defineConfig({ providers: [plain, provider], vars: {} });
        const queries = ["stripe", "payments"];
        const report = yield* find(config, queries);

        expect(searches.map((search) => search.queries)).toEqual([queries]);
        expect(report.skipped).toEqual([plain.id]);

        expect(report.queries).toEqual([
          {
            query: "stripe",
            references: [
              { provider: provider.id, reference: "search://app/stripe" },
              { provider: provider.id, reference: "search://payments/stripe" },
            ],
          },
          {
            query: "payments",
            references: [{ provider: provider.id, reference: "search://payments/stripe" }],
          },
        ]);
      }).pipe(Effect.provide(enviLayer())),
  );

  it.effect("searches without a prompt in CI", () =>
    Effect.gen(function* () {
      const { provider, searches } = searching([]);
      const config = defineConfig({ providers: [provider], vars: {} });

      yield* find(config, ["stripe"]).pipe(withEnv({ CI: "true" }));
      yield* find(config, ["stripe"]).pipe(withEnv({}));

      expect(searches.map((search) => search.interactive)).toEqual([false, true]);
    }).pipe(Effect.provide(enviLayer())),
  );

  it.effect("fails with the error of a provider that cannot search", () =>
    Effect.gen(function* () {
      const unavailable = new ProviderError({
        reason: ProviderFailure.Unavailable,
        provider: "broken",
        detail: "The test provider is down.",
      });

      const broken = Provider.make({
        id: "broken",
        scope: "broken",
        resolveMany: () => Effect.fail(unavailable),
        discover: () => Effect.fail(unavailable),
        helpers: {},
      });

      const error = yield* Effect.flip(
        find(defineConfig({ providers: [broken], vars: {} }), ["stripe"]),
      );

      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ reason: ProviderFailure.Unavailable, provider: broken.id });
    }).pipe(Effect.provide(enviLayer())),
  );
});
