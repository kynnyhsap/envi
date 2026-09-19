import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import * as Timing from "./Timing.ts";

const LoggedSchema = Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number]));

type Logged = typeof LoggedSchema.Type;

/** Runs an effect and returns the annotations of every log line that the effect wrote. */
const capture = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const lines: Array<Logged> = [];

    const logger = Logger.map(Logger.formatStructured, (line) => {
      lines.push({
        level: line.level,
        ...Schema.decodeUnknownSync(LoggedSchema)(line.annotations),
      });
    });

    const exit = yield* effect.pipe(
      Effect.provide(Logger.layer([logger])),
      Effect.provideService(References.MinimumLogLevel, "Debug"),
      Effect.exit,
    );

    return { exit, lines };
  });

describe("Timing.measure", () => {
  it.effect("logs the duration of a step that succeeds, at debug level", () =>
    Effect.gen(function* () {
      const step = Effect.as(TestClock.adjust("250 millis"), "value");
      const { exit, lines } = yield* capture(step.pipe(Timing.measure("cache.read")));

      expect(exit).toEqual(Effect.runSync(Effect.exit(Effect.succeed("value"))));
      expect(lines).toEqual([
        { level: "DEBUG", step: "cache.read", durationMs: 250, outcome: "success" },
      ]);
    }),
  );

  it.effect("logs the duration of a step that fails, and keeps the failure", () =>
    Effect.gen(function* () {
      const step = Effect.andThen(TestClock.adjust("40 millis"), Effect.fail("down"));
      const { exit, lines } = yield* capture(step.pipe(Timing.measure("provider.resolve")));

      expect(exit).toEqual(Effect.runSync(Effect.exit(Effect.fail("down"))));
      expect(lines).toEqual([
        { level: "DEBUG", step: "provider.resolve", durationMs: 40, outcome: "failure" },
      ]);
    }),
  );

  it.effect("adds the given annotations to the line", () =>
    Effect.gen(function* () {
      const { lines } = yield* capture(
        Effect.void.pipe(Timing.measure("provider.resolve", { provider: "memory" })),
      );

      expect(lines).toEqual([
        {
          level: "DEBUG",
          step: "provider.resolve",
          durationMs: 0,
          outcome: "success",
          provider: "memory",
        },
      ]);
    }),
  );
});
