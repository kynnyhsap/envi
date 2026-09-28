// The stale fallback through the `Envi` service: when an expired cache entry serves a run, and
// when a setting or a failure forbids it. Each case syncs while the provider is up, lets the
// entries expire, and then checks while the provider fails.
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";

import { type Config, defineConfig } from "./Config.ts";
import * as Envi from "./Envi.ts";
import { ProviderError, ProviderFailure, ReferenceFailure } from "./Errors.ts";
import { enviLayer, withEnv } from "./fixtures/Support.ts";
import { mem, memoryProviderId } from "./Memory.ts";
import * as Provider from "./Provider.ts";

const values = new Map([
  ["a", "1"],
  ["b", "2"],
]);

/** How the provider answers: with the values, as a whole outage, or with one reason per key. */
type Mode = "up" | "down" | ReferenceFailure;

/** The switch of a provider. The test sets `mode` between two operations. */
interface Switch {
  mode: Mode;
}

/** A provider with the id of `mem()`, whose answer the test switches. */
const switchable = () => {
  const state: Switch = { mode: "up" };

  const provider = Provider.make({
    id: memoryProviderId,
    scope: "switchable",
    resolveMany: (requests) =>
      Effect.suspend(() => {
        const { mode } = state;

        if (mode === "down") {
          return Effect.fail(
            new ProviderError({
              reason: ProviderFailure.Unavailable,
              provider: memoryProviderId,
              detail: "The test provider is down.",
            }),
          );
        }

        return Effect.succeed(
          Object.fromEntries(
            requests.map((request) => [
              request.key,
              mode === "up"
                ? Result.succeed(values.get(request.reference) ?? "")
                : Result.fail<ReferenceFailure>(mode),
            ]),
          ),
        );
      }),
    helpers: {},
  });

  return { state, provider };
};

/** Past the default TTL of 24 hours, and within the default stale limit of 7 days. */
const expired = "2 days";

/**
 * Syncs `config` while the provider is up, lets the entries expire, switches the provider to
 * `mode`, and checks again. Each call has its own memory cache.
 */
const checkAfterExpiry = (
  vars: (provider: Provider.Provider) => Config,
  mode: Exclude<Mode, "up">,
  options: {
    readonly env?: Readonly<Record<string, string>>;
    readonly strict?: boolean;
  } = {},
) =>
  Effect.gen(function* () {
    const { state, provider } = switchable();
    const config = vars(provider);
    const envi = yield* Envi.Envi;

    yield* envi.sync(config);
    yield* TestClock.adjust(expired);
    state.mode = mode;

    return yield* envi.check(config, { strict: options.strict });
  }).pipe(Effect.provide(enviLayer()), withEnv(options.env ?? {}));

const plain = (provider: Provider.Provider) =>
  defineConfig({ providers: [provider], vars: { A: mem("a") } });

const strictConfig = (provider: Provider.Provider) =>
  defineConfig({ providers: [provider], strict: true, vars: { A: mem("a") } });

const unavailable = { error: "ProviderError", reason: ProviderFailure.Unavailable };

describe("the stale fallback", () => {
  it.effect("serves an expired value while the provider is down, up to maxStale", () =>
    Effect.gen(function* () {
      const report = yield* checkAfterExpiry(
        (provider) =>
          defineConfig({
            providers: [provider],
            vars: { A: mem("a"), B: mem("b").cache({ maxStale: "1 day" }) },
          }),
        "down",
      );

      expect(report.passed).toEqual(["A"]);
      expect(report.failures).toMatchObject([{ key: "B", ...unavailable }]);
    }),
  );

  it.effect("applies the maxStale of the config to every var", () =>
    Effect.gen(function* () {
      const report = yield* checkAfterExpiry(
        (provider) =>
          defineConfig({
            providers: [provider],
            cache: { maxStale: "1 day" },
            vars: { A: mem("a"), B: mem("b") },
          }),
        "down",
      );

      expect(report.passed).toEqual([]);
      expect(report.failures).toMatchObject([
        { key: "A", ...unavailable },
        { key: "B", ...unavailable },
      ]);
    }),
  );

  describe("strict", () => {
    it.effect("turns the fallback off with the config key", () =>
      Effect.gen(function* () {
        const report = yield* checkAfterExpiry(strictConfig, "down");

        expect(report.failures).toMatchObject([{ key: "A", ...unavailable }]);
      }),
    );

    it.effect("lets ENVI_STRICT and the call option win over the config key", () =>
      Effect.gen(function* () {
        const byVariable = yield* checkAfterExpiry(strictConfig, "down", {
          env: { ENVI_STRICT: "false" },
        });

        const byOption = yield* checkAfterExpiry(strictConfig, "down", { strict: false });

        expect(byVariable.passed).toEqual(["A"]);
        expect(byOption.passed).toEqual(["A"]);
      }),
    );

    it.effect("is always on in CI, even against the call option", () =>
      Effect.gen(function* () {
        const report = yield* checkAfterExpiry(plain, "down", {
          env: { CI: "true" },
          strict: false,
        });

        expect(report.failures).toMatchObject([{ key: "A", ...unavailable }]);
      }),
    );
  });

  it.effect.each([
    ReferenceFailure.NotFound,
    ReferenceFailure.AccessDenied,
    ReferenceFailure.Invalid,
  ])("never serves an expired value after %s", (reason) =>
    Effect.gen(function* () {
      const report = yield* checkAfterExpiry(plain, reason);

      expect(report.passed).toEqual([]);
      expect(report.failures).toMatchObject([{ key: "A", error: "SecretReferenceError", reason }]);
    }),
  );
});
