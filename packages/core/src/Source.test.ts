import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { CustomError, CustomFailure, CustomReason, DeriveError } from "./Errors.ts";
import * as Source from "./Source.ts";

/** Calls the user code of a `derive()` or `custom()` value with decoded inputs, in input order. */
const call = (
  source: Source.AnySource,
  decodedInputs: ReadonlyArray<unknown>,
): Effect.Effect<Option.Option<string>, CustomError | DeriveError> => {
  const withInputs = <E>(origin: {
    readonly inputs: Readonly<Record<string, Source.AnySource>>;
    readonly call: Source.Call<E>;
  }) =>
    origin.call(
      Object.fromEntries(
        Object.keys(origin.inputs).map((name, index) => [name, decodedInputs[index]]),
      ),
    );

  const origin = source.origin;

  if (Source.Origin.$is("Custom")(origin)) {
    return withInputs<CustomError | DeriveError>(origin);
  }

  return Source.Origin.$is("Derived")(origin)
    ? withInputs<CustomError | DeriveError>(origin)
    : Effect.die("not a source with user code");
};

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

  describe("derive", () => {
    it.effect("passes one decoded input, or a record of decoded inputs", () =>
      Effect.gen(function* () {
        const port = Source.reference("memory", "port").schema(Schema.NumberFromString);
        const next = Source.derive(port, (value) => String(value + 1));

        const url = Source.derive(
          { user: Source.reference("memory", "user"), port },
          ({ user, port: value }) => `postgres://${user}@db:${value}`,
        );

        expect(next.isRedacted).toBe(true);
        expect(yield* call(next, [5432])).toEqual(Option.some("5433"));
        expect(yield* call(url, ["app", 5432])).toEqual(Option.some("postgres://app@db:5432"));
      }),
    );

    it.effect("treats undefined as a missing value", () =>
      Effect.gen(function* () {
        const empty = Source.derive(Source.reference("memory", "a"), () => undefined);

        expect(yield* call(empty, ["a"])).toEqual(Option.none());
      }),
    );

    it.effect("turns a throw into a DeriveError with the class name and the location", () =>
      Effect.gen(function* () {
        const broken = Source.derive(Source.reference("memory", "a"), () => {
          throw new TypeError("secret-in-message");
        });

        const error = yield* Effect.flip(call(broken, ["a"]));

        expect(error).toBeInstanceOf(DeriveError);
        expect(error.thrown).toBe("TypeError");
        expect(error.location).toMatch(/Source\.test\.ts:\d+:\d+$/u);
        expect(error.message).not.toContain("secret-in-message");
        expect(JSON.stringify(error)).not.toContain("secret-in-message");
      }),
    );
  });

  describe("custom", () => {
    it.effect("accepts a string, undefined, a promise, and an effect from resolve", () =>
      Effect.gen(function* () {
        const plain = Source.custom({ id: "a", resolve: () => "a" });
        const missing = Source.custom({ id: "b", resolve: () => undefined });
        const promised = Source.custom({ id: "c", resolve: async () => "c" });
        const effectful = Source.custom({ id: "d", resolve: () => Effect.succeed("d") });

        expect(yield* call(plain, [])).toEqual(Option.some("a"));
        expect(yield* call(missing, [])).toEqual(Option.none());
        expect(yield* call(promised, [])).toEqual(Option.some("c"));
        expect(yield* call(effectful, [])).toEqual(Option.some("d"));
      }),
    );

    it.effect("passes the decoded inputs to resolve", () =>
      Effect.gen(function* () {
        const url = Source.custom({
          id: "url",
          from: {
            user: Source.reference("memory", "user"),
            port: Source.reference("memory", "port").schema(Schema.NumberFromString),
          },
          resolve: ({ user, port }) => `postgres://${user}@db:${port + 1}`,
        });

        expect(yield* call(url, ["app", 5432])).toEqual(Option.some("postgres://app@db:5433"));
      }),
    );

    it("keeps the id, the scope, and the source text of resolve for the cache key", () => {
      const token = Source.custom({
        id: "token",
        scope: "https://auth.example.com",
        resolve: () => "t",
      });

      const plain = Source.custom({ id: "plain", resolve: () => "p" });

      assert(Source.Origin.$is("Custom")(token.origin));
      assert(Source.Origin.$is("Custom")(plain.origin));
      expect(token.origin.id).toBe("token");
      expect(token.origin.scope).toBe("https://auth.example.com");
      expect(token.origin.code).toContain('"t"');
      expect(plain.origin.scope).toBe("");
    });

    it.effect(
      "turns a throw, a rejection, and a failure into a CustomError that hides the message",
      () =>
        Effect.gen(function* () {
          const thrown = Source.custom({
            id: "build",
            resolve: () => {
              throw new RangeError("secret-in-message");
            },
          });

          const rejected = Source.custom({
            id: "build",
            resolve: () => Promise.reject(new Error("secret-in-message")),
          });

          const failed = Source.custom({
            id: "build",
            resolve: () => Effect.fail("secret-in-message"),
          });

          for (const source of [thrown, rejected, failed]) {
            const error = yield* Effect.flip(call(source, []));

            expect(error).toBeInstanceOf(CustomError);
            expect(error).toMatchObject({
              reason: CustomReason.Threw,
              id: "build",
              transient: false,
            });
            expect(error.message).not.toContain("secret-in-message");
            expect(JSON.stringify(error)).not.toContain("secret-in-message");
          }

          const fromThrow = yield* Effect.flip(call(thrown, []));

          expect(fromThrow.thrown).toBe("RangeError");
          expect(fromThrow.location).toMatch(/Source\.test\.ts:\d+:\d+$/u);
        }),
    );

    it.effect("shows the message of a CustomFailure, and keeps its transient flag", () =>
      Effect.gen(function* () {
        const failure = new CustomFailure({
          message: "The token service is down.",
          transient: true,
        });

        const sources = [
          Source.custom({ id: "a", resolve: () => Effect.fail(failure) }),
          Source.custom({ id: "a", resolve: () => Promise.reject(failure) }),
          Source.custom({
            id: "a",
            resolve: () => {
              throw failure;
            },
          }),
        ];

        for (const source of sources) {
          const error = yield* Effect.flip(call(source, []));

          expect(error).toMatchObject({
            reason: CustomReason.Failed,
            detail: "The token service is down.",
            transient: true,
          });
          expect(error.message).toContain("The token service is down.");
        }
      }),
    );
  });
});
