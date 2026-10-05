import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { ChildProcess } from "effect/process";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

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

/** A subscription that receives the signals of the stream. */
const withSignals = (signals: Stream.Stream<Signals.Received>) =>
  Effect.provideService(
    Signals.Signals,
    Effect.tap(Queue.unbounded<Signals.Received>(), (queue) =>
      Effect.forkScoped(Stream.runForEach(signals, (signal) => Queue.offer(queue, signal))),
    ),
  );

const forwarded = (name: Signals.SignalName): Signals.Received => ({ name, forward: true });

layer(Platform.layer, { excludeTestServices: true })("Signals.supervise", (it) => {
  describe("with real child processes", () => {
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

    it.effect("forwards a second signal while the child still runs after the first", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const ready = path.join(yield* fs.makeTempDirectoryScoped(), "ready");

        // The child ignores SIGHUP and exits on SIGTERM. It writes `ready` after it installs both
        // handlers, and the first signal waits for that file.
        const child = node(
          `process.on('SIGHUP', () => {}); process.on('SIGTERM', () => process.exit(7)); require('node:fs').writeFileSync(${JSON.stringify(ready)}, ''); setInterval(() => {}, 1000);`,
        );

        const whenReady = Effect.repeat(fs.exists(ready), {
          until: (exists) => exists,
          schedule: Schedule.spaced("10 millis"),
        }).pipe(Effect.orDie);

        // A forward that waited for the exit of the child would never send SIGTERM.
        const signals = Stream.concat(
          Stream.fromEffect(Effect.as(whenReady, forwarded("SIGHUP"))),
          Stream.make(forwarded("SIGTERM")),
        );

        const code = yield* Signals.supervise(child).pipe(withSignals(signals));

        expect(code).toEqual(Option.some(7));
      }),
    );
  });
});
