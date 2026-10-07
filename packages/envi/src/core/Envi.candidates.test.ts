// The close references of a NotFound failure. After a resolution, Envi asks each provider that can
// search for the references close to each missing reference. The search is best effort: it never
// turns NotFound into another failure.
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Result from "effect/Result";
import * as Scheduler from "effect/Scheduler";
import * as TestClock from "effect/testing/TestClock";

import { type Config, defineConfig } from "./Config.ts";
import * as Envi from "./Envi.ts";
import { ProviderError, ProviderFailure, ReferenceFailure, VarsError } from "./Errors.ts";
import { enviLayer } from "./fixtures/Support.ts";
import * as Provider from "./Provider.ts";
import { reference } from "./Source.ts";

const providerId = "search";

const describeKey = (key: string) => `${providerId}://${key}`;

const secrets = new Map([["db/production", "postgres://fake"]]);

/** The references that the search lists for a missing reference, the closest first. */
const close = ["db/production", "db/preview", "db/staging", "db/development"];

/** A provider whose search lists `close` for every query, and records the queries. */
const searching = (discover?: () => Effect.Effect<never, ProviderError>) => {
  const searches: Array<ReadonlyArray<string>> = [];

  const provider = Provider.make({
    id: providerId,
    scope: providerId,
    resolveMany: (requests) =>
      Effect.succeed(
        Object.fromEntries(
          requests.map((request) => {
            const secret = secrets.get(request.reference);

            return [
              request.key,
              secret === undefined
                ? Result.fail(ReferenceFailure.NotFound)
                : Result.succeed(secret),
            ];
          }),
        ),
      ),
    discover: (queries) =>
      discover?.() ??
      Effect.sync(() => {
        searches.push(queries);

        return Object.fromEntries(queries.map((query) => [query, close]));
      }),
    helpers: {},
  });

  return { provider, searches };
};

const configOf = (provider: Provider.Provider) =>
  defineConfig({
    providers: [provider],
    vars: {
      DATABASE_URL: reference(providerId, "db/prod"),
      REPLICA_URL: reference(providerId, "db/replica"),
      CACHE_URL: reference(providerId, "cache").optional(),
    },
  });

/** Moves the test clock until the fiber ends. A timer can start after the fork, so one move can miss it. */
const joinWithClock = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Effect.gen(function* () {
    while (fiber.pollUnsafe() === undefined) {
      yield* TestClock.adjust("10 seconds");
    }

    return yield* Fiber.join(fiber);
  });

/** The failed vars of a load, and the summary of each. */
const failuresOf = (config: Config) =>
  Effect.gen(function* () {
    const envi = yield* Envi.Envi;
    const error = yield* Effect.flip(envi.load(config));

    return error instanceof VarsError ? error.failures : [];
  });

describe("the close references of a NotFound failure", () => {
  it.effect(
    "lists the closest references in the error, with one search for every missing one",
    () =>
      Effect.gen(function* () {
        const { provider, searches } = searching();
        const failures = yield* failuresOf(configOf(provider));
        const expected = close.slice(0, 3).map(describeKey);

        expect(searches).toEqual([[describeKey("db/prod"), describeKey("db/replica")]]);
        expect(failures.map(({ key }) => key)).toEqual(["DATABASE_URL", "REPLICA_URL"]);

        for (const { error } of failures) {
          expect(error).toMatchObject({ reason: ReferenceFailure.NotFound, candidates: expected });
          expect(error.summary).toContain(expected.join(", "));
        }
      }).pipe(Effect.provide(enviLayer())),
  );

  it.effect(
    "keeps a plain NotFound when the search fails, does not answer, or never cleans up",
    () =>
      Effect.gen(function* () {
        const failing = searching(() =>
          Effect.fail(
            new ProviderError({
              reason: ProviderFailure.Unavailable,
              provider: providerId,
              detail: "The test search is down.",
            }),
          ),
        );

        const hanging = searching(() => Effect.never);
        const stuck = searching(() => Effect.never.pipe(Effect.onInterrupt(() => Effect.never)));
        const failed = yield* failuresOf(configOf(failing.provider));
        const unanswered = yield* Effect.forkChild(failuresOf(configOf(hanging.provider)));
        const uncleaned = yield* Effect.forkChild(failuresOf(configOf(stuck.provider)));

        for (const failures of [
          failed,
          yield* joinWithClock(unanswered),
          yield* joinWithClock(uncleaned),
        ]) {
          expect(failures.map(({ key }) => key)).toEqual(["DATABASE_URL", "REPLICA_URL"]);

          for (const { error } of failures) {
            expect(error).toMatchObject({ reason: ReferenceFailure.NotFound });
            expect(error).not.toHaveProperty("candidates");
          }
        }
      }).pipe(Effect.provide(enviLayer())),
  );

  it.effect("stops the search when a program cancels the load, at any yield point", () =>
    Effect.gen(function* () {
      // A small budget of operations makes the fibers yield at other points of the search. With a
      // budget below 3, the load does not reach the search in the time of a test.
      for (let maxOps = 3; maxOps <= 100; maxOps++) {
        const started = yield* Deferred.make<void>();
        const stopped = yield* Deferred.make<void>();

        const { provider } = searching(() =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(stopped, undefined)),
          ),
        );

        const load = yield* Effect.forkChild(
          failuresOf(configOf(provider)).pipe(
            Effect.provideService(Scheduler.MaxOpsBeforeYield, maxOps),
          ),
        );

        yield* Deferred.await(started);
        yield* Fiber.interrupt(load);
        yield* Deferred.await(stopped);

        expect(yield* Deferred.isDone(stopped)).toBe(true);
      }
    }).pipe(Effect.provide(enviLayer())),
  );

  it.effect("keeps a plain NotFound for a reference with the name of an object property", () =>
    Effect.gen(function* () {
      const names = ["toString", "constructor", "__proto__"];

      const base = {
        id: providerId,
        scope: providerId,
        describe: (key: string) => key,
        resolveMany: (requests: ReadonlyArray<Provider.ProviderRequest<string>>) =>
          Effect.succeed(
            Object.fromEntries(
              requests.map((request) => [request.key, Result.fail(ReferenceFailure.NotFound)]),
            ),
          ),
        helpers: {},
      };

      const unavailable = new ProviderError({
        reason: ProviderFailure.Unavailable,
        provider: providerId,
        detail: "The test search is down.",
      });

      const answering = Provider.make({ ...base, discover: () => Effect.succeed({}) });

      // A search that fails, and a provider without a search, give no answer at all.
      const providers = [
        answering,
        Provider.make({ ...base, discover: () => Effect.fail(unavailable) }),
        Provider.make(base),
      ];

      const configOfProvider = (provider: Provider.Provider) =>
        defineConfig({
          providers: [provider],
          vars: Object.fromEntries(
            names.map((name) => [name.toUpperCase(), reference(providerId, name)]),
          ),
        });

      for (const provider of providers) {
        const failures = yield* failuresOf(configOfProvider(provider));

        expect(failures.map(({ key }) => key)).toEqual(names.map((name) => name.toUpperCase()));

        for (const { error } of failures) {
          expect(error).toMatchObject({ reason: ReferenceFailure.NotFound });
          expect(error).not.toHaveProperty("candidates");
        }
      }

      const report = yield* Effect.flatMap(Envi.Envi, (envi) =>
        envi.find(configOfProvider(answering), names),
      );

      expect(report.queries).toEqual(names.map((query) => ({ query, references: [] })));
    }).pipe(Effect.provide(enviLayer())),
  );

  it.effect("does not search when only an optional var is missing", () =>
    Effect.gen(function* () {
      const { provider, searches } = searching();

      const config = defineConfig({
        providers: [provider],
        vars: {
          DATABASE_URL: reference(providerId, "db/production"),
          CACHE_URL: reference(providerId, "cache").optional(),
        },
      });

      const env = yield* Effect.flatMap(Envi.Envi, (envi) => envi.load(config));

      expect(env).toEqual({ DATABASE_URL: secrets.get("db/production"), CACHE_URL: undefined });
      expect(searches).toEqual([]);
    }).pipe(Effect.provide(enviLayer())),
  );
});
