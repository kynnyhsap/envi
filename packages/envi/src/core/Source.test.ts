import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { CustomError, CustomFailure, CustomReason } from "./Errors.ts";
import * as Source from "./Source.ts";

/** Calls the user code of a `custom()` value with decoded inputs, in input order. */
const call = (
  source: Source.AnySource,
  decodedInputs: ReadonlyArray<unknown>,
): Effect.Effect<Option.Option<string>, CustomError> => {
  const { origin } = source;

  return Source.Origin.$is("Custom")(origin)
    ? origin.call(
        Object.fromEntries(
          Object.keys(origin.inputs).map((name, index) => [name, decodedInputs[index]]),
        ),
      )
    : Effect.die("not a custom() value");
};

describe("Source", () => {
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
