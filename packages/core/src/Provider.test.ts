import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { ProviderFailure, ReferenceFailure } from "./Errors.ts";
import { mem, memoryProvider } from "./Memory.ts";
import * as Provider from "./Provider.ts";
import * as Source from "./Source.ts";

const interactive: Provider.ResolveContext = { interactive: true };

describe("Provider", () => {
  it.effect("describes a reference and gives its reference key", () =>
    Effect.gen(function* () {
      const provider = memoryProvider({ "db/url": "postgres://localhost/app" });
      const prepared = yield* provider.prepare("db/url");

      expect(prepared).toEqual({
        referenceKey: "memory://db/url",
        description: "memory://db/url",
      });
    }),
  );

  it.effect("defaults to a string reference that it describes with its id", () =>
    Effect.gen(function* () {
      const provider = Provider.make({
        id: "vault",
        scope: "https://vault.example.com",
        resolveMany: (requests) =>
          Effect.succeed(
            Object.fromEntries(requests.map((request) => [request.key, Result.succeed("value")])),
          ),
        helpers: {},
      });

      expect(yield* provider.prepare("db/url")).toEqual({
        referenceKey: "vault://db/url",
        description: "vault://db/url",
      });
      expect((yield* Effect.flip(provider.prepare({ not: "a string" }))).reason).toBe(
        ReferenceFailure.Invalid,
      );
    }),
  );

  it.effect("rejects a reference that does not match the schema of the provider", () =>
    Effect.gen(function* () {
      const provider = memoryProvider({});
      const error = yield* Effect.flip(provider.prepare({ not: "a key" }));

      expect(error.reason).toBe(ReferenceFailure.Invalid);
      expect(error.provider).toBe("memory");
    }),
  );

  it.effect("resolves one batch and reports a missing secret for its own key", () =>
    Effect.gen(function* () {
      const provider = memoryProvider({ a: "1" });

      const results = yield* provider.resolveMany(
        [
          { key: "k1", reference: "a" },
          { key: "k2", reference: "missing" },
        ],
        interactive,
      );

      expect(results).toEqual({
        k1: Result.succeed("1"),
        k2: Result.fail(ReferenceFailure.NotFound),
      });
      expect(provider.calls()).toEqual([["a", "missing"]]);
    }),
  );

  it("builds a descriptor for the memory provider", () => {
    expect(mem("a").origin).toEqual(
      Source.Origin.Reference({ provider: "memory", reference: "a" }),
    );
  });
});

describe("Providers", () => {
  it.effect("finds a provider by its id", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Providers;

      expect((yield* providers.get("memory")).id).toBe("memory");
    }).pipe(Effect.provide(Provider.layer([memoryProvider({})]))),
  );

  it.effect("fails for an id that no provider has", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Providers;
      const error = yield* Effect.flip(providers.get("onepassword"));

      expect(error.reason).toBe(ProviderFailure.UnknownProvider);
    }).pipe(Effect.provide(Provider.layer([memoryProvider({})]))),
  );

  it.effect("rejects two providers with one id", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.provide(
          Provider.Providers,
          Provider.layer([memoryProvider({}), memoryProvider({})]),
        ),
      );

      expect(error.reason).toBe(ProviderFailure.Misconfigured);
    }),
  );
});
