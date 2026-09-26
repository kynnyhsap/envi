import { describe, expect, layer } from "@effect/vitest";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { ChildProcess } from "effect/unstable/process";

import * as Platform from "../platform.ts";
import * as Signals from "./Signals.ts";

const node = (script: string) =>
  ChildProcess.make("node", ["-e", script], {
    detached: false,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });

/** A child that sends a signal to itself, the way a terminal sends Ctrl-C to it before Envi. */
const endsItselfWith = (name: string) =>
  `process.kill(process.pid, '${name}'); setInterval(() => {}, 1000);`;

const handlesSigterm = "process.on('SIGTERM', () => process.exit(7)); setInterval(() => {}, 1000);";

const ignoresSighup =
  "process.on('SIGHUP', () => {}); process.on('SIGTERM', () => process.exit(7)); setInterval(() => {}, 1000);";

const withSignals = (signals: Stream.Stream<Signals.Received>) =>
  Effect.provideService(Signals.Signals, signals);

const after = (delay: Duration.Input, name: Signals.SignalName) =>
  Stream.fromEffect(Effect.as(Effect.sleep(delay), { name, forward: true }));

layer(Platform.layer, { excludeTestServices: true })("Signals.supervise", (it) => {
  describe("with real child processes", () => {
    it.effect("returns the exit code of the child", () =>
      Effect.gen(function* () {
        expect(yield* Signals.supervise(node("process.exit(5)"))).toEqual(Option.some(5));
      }),
    );

    it.effect.each([
      ["SIGHUP", 129],
      ["SIGINT", 130],
      ["SIGTERM", 143],
    ] as const)(
      "returns 128 plus the number when %s ends the child before Envi sees it",
      ([name, code]) =>
        Effect.gen(function* () {
          expect(yield* Signals.supervise(node(endsItselfWith(name)))).toEqual(Option.some(code));
        }),
    );

    it.effect("returns nothing when another signal ends the child", () =>
      Effect.gen(function* () {
        expect(yield* Signals.supervise(node(endsItselfWith("SIGKILL")))).toEqual(Option.none());
      }),
    );

    it.effect("forwards a signal, and the child decides the exit code", () =>
      Effect.gen(function* () {
        // The delay lets the child install its handler before the signal arrives.
        const delayed = Stream.fromEffect(
          Effect.as(Effect.sleep("700 millis"), { name: "SIGTERM", forward: true } as const),
        );

        const code = yield* Signals.supervise(node(handlesSigterm)).pipe(withSignals(delayed));

        expect(code).toEqual(Option.some(7));
      }),
    );

    it.effect("forwards a second signal while the child still runs after the first", () =>
      Effect.gen(function* () {
        const signals = Stream.concat(
          after("700 millis", "SIGHUP"),
          after("300 millis", "SIGTERM"),
        );

        const code = yield* Signals.supervise(node(ignoresSighup)).pipe(withSignals(signals));

        expect(code).toEqual(Option.some(7));
      }),
    );
  });
});
