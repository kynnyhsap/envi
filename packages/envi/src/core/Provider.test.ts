import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { ProviderFailure, ReferenceFailure } from "./Errors.ts";
import { memoryProvider } from "./Memory.ts";
import * as Provider from "./Provider.ts";

describe("Provider", () => {
  it.effect("describes a string reference with its id by default, and rejects another form", () =>
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

      const error = yield* Effect.flip(provider.prepare({ not: "a string" }));

      expect(yield* provider.prepare("db/url")).toEqual({
        referenceKey: "vault://db/url",
        description: "vault://db/url",
      });
      expect(error).toMatchObject({ reason: ReferenceFailure.Invalid, provider: "vault" });
    }),
  );
});

describe("Providers", () => {
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
