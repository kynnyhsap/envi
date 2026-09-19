import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { ChildProcess } from "effect/unstable/process";

import * as Signals from "./Signals.ts";

const node = (script: string) =>
  ChildProcess.make("node", ["-e", script], {
    detached: false,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });

const endsItself = "process.kill(process.pid, 'SIGTERM'); setInterval(() => {}, 1000);";

const handlesSigterm = "process.on('SIGTERM', () => process.exit(7)); setInterval(() => {}, 1000);";

const withSignals = (signals: Stream.Stream<Signals.Received>) =>
  Effect.provideService(Signals.Signals, signals);

layer(NodeServices.layer, { excludeTestServices: true })("Signals.supervise", (it) => {
  describe("with real child processes", () => {
    it.effect("returns the exit code of the child", () =>
      Effect.gen(function* () {
        expect(yield* Signals.supervise(node("process.exit(5)"))).toEqual(Option.some(5));
      }),
    );

    it.effect("returns nothing when a signal that Envi did not receive ends the child", () =>
      Effect.gen(function* () {
        expect(yield* Signals.supervise(node(endsItself))).toEqual(Option.none());
      }),
    );

    it.effect("returns 128 plus the number of the received signal", () =>
      Effect.gen(function* () {
        const code = yield* Signals.supervise(node(endsItself)).pipe(
          withSignals(Stream.make({ name: "SIGTERM", forward: false })),
        );

        expect(code).toEqual(Option.some(143));
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
  });
});
