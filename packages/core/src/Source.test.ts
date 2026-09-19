import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ProviderFailure } from "./Errors.ts";
import * as Source from "./Source.ts";

/** Resolves each input from a fixed list of decoded values, in the order of the inputs. */
const run = (source: Source.AnySource, decodedInputs: ReadonlyArray<string | number>) =>
  Source.Origin.$match(source.origin, {
    Custom: (origin) => {
      const byInput = new Map(origin.inputs.map((input, index) => [input, decodedInputs[index]]));

      return origin.run((input) =>
        // SAFETY: A test fixture. The test passes a value of the decoded type of each input.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        Effect.succeed(byInput.get(input) as Source.Decoded<typeof input>),
      );
    },
    Environment: () => Effect.die("not a custom source"),
    Literal: () => Effect.die("not a custom source"),
    Reference: () => Effect.die("not a custom source"),
  });

describe("Source", () => {
  it("builds a literal that Envi does not redact", () => {
    const port = Source.value("3000");

    expect(Source.isSource(port)).toBe(true);
    expect(port.origin).toEqual(Source.Origin.Literal({ value: "3000" }));
    expect(port.isRedacted).toBe(false);
    expect(port.isOptional).toBe(false);
  });

  it("builds a reference that Envi redacts", () => {
    const secret = Source.reference("memory", { key: "db/url" });

    expect(secret.origin).toEqual(
      Source.Origin.Reference({ provider: "memory", reference: { key: "db/url" } }),
    );
    expect(secret.isRedacted).toBe(true);
  });

  it("returns a new descriptor from each chained method", () => {
    const base = Source.reference("memory", "a");
    const changed = base.optional().redact(false).cache(false);

    expect(base.isOptional).toBe(false);
    expect(base.isRedacted).toBe(true);
    expect(base.cachePolicy).toEqual(Source.CachePolicy.Inherit());
    expect(changed.isOptional).toBe(true);
    expect(changed.isRedacted).toBe(false);
    expect(changed.cachePolicy).toEqual(Source.CachePolicy.Disabled());
  });

  it("replaces optional with a default", () => {
    const level = Source.reference("memory", "level").optional().default("info");

    expect(level.isOptional).toBe(false);
    expect(level.fallback).toEqual(Option.some("info"));
  });

  it("keeps a cache override", () => {
    const token = Source.reference("memory", "token").cache({ ttl: "1 hour" });

    expect(token.cachePolicy).toEqual(
      Source.CachePolicy.Override({ ttl: Option.some("1 hour"), maxStale: Option.none() }),
    );
  });

  it("reads an environment variable by name", () => {
    expect(Source.fromEnv("GITHUB_SHA").origin).toEqual(
      Source.Origin.Environment({ name: "GITHUB_SHA" }),
    );
  });

  it.effect("decodes a raw string with the schema of the descriptor", () =>
    Effect.gen(function* () {
      const port = Source.value("3000").schema(Schema.NumberFromString);

      expect(yield* Source.decode(port, "PORT", "3000")).toBe(3000);
    }),
  );

  it.effect("fails with the var key and without the rejected value", () =>
    Effect.gen(function* () {
      const port = Source.value("x").schema(Schema.FiniteFromString);
      const error = yield* Effect.flip(Source.decode(port, "PORT", "not-a-number-secret"));

      expect(error.key).toBe("PORT");
      expect(JSON.stringify(error)).not.toContain("not-a-number-secret");
      expect(error.message).not.toContain("not-a-number-secret");
    }),
  );

  describe("custom", () => {
    it.effect("accepts a string, a promise, and an effect from resolve", () =>
      Effect.gen(function* () {
        const plain = Source.custom({ resolve: () => "a" });
        const promised = Source.custom({ resolve: async () => "b" });
        const effectful = Source.custom({ resolve: () => Effect.succeed("c") });

        expect(yield* run(plain, [])).toBe("a");
        expect(yield* run(promised, [])).toBe("b");
        expect(yield* run(effectful, [])).toBe("c");
      }),
    );

    it.effect("passes the decoded inputs to resolve", () =>
      Effect.gen(function* () {
        const url = Source.custom({
          from: {
            user: Source.reference("memory", "user"),
            port: Source.reference("memory", "port").schema(Schema.NumberFromString),
          },
          resolve: ({ user, port }) => `postgres://${user}@db:${port + 1}`,
        });

        expect(yield* run(url, ["app", 5432])).toBe("postgres://app@db:5433");
      }),
    );

    it.effect("turns a thrown error, a rejection, and a failure into a provider error", () =>
      Effect.gen(function* () {
        const thrown = Source.custom({
          key: "build",
          resolve: () => {
            throw new Error("secret-in-message");
          },
        });

        const rejected = Source.custom({ resolve: () => Promise.reject(new Error("nope")) });
        const failed = Source.custom({ resolve: () => Effect.fail("nope") });

        for (const source of [thrown, rejected, failed]) {
          const error = yield* Effect.flip(run(source, []));

          expect(error.reason).toBe(ProviderFailure.Unavailable);
          expect(error.provider).toBe(Source.customProviderId);
          expect(error.message).not.toContain("secret-in-message");
        }
      }),
    );
  });
});
