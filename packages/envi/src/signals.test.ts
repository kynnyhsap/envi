import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ChildProcess } from "effect/process";
import { ChildProcessSpawner, make } from "effect/process/ChildProcessSpawner";

import * as Signals from "./core/Signals.ts";
import * as Platform from "./platform.ts";
import * as ProcessSignals from "./signals.ts";

/** A shell reports a child that SIGHUP ended with this code. */
const sighupExitCode = 129;

/** Sends SIGHUP to this process, and waits until the process received it. */
const receiveSighup = Effect.callback<void>((resume) => {
  process.once("SIGHUP", () => {
    resume(Effect.void);
  });
  process.kill(process.pid, "SIGHUP");
});

/** The spawner of the platform. This process receives a SIGHUP before a spawn returns. */
const signalDuringSpawn = Effect.map(ChildProcessSpawner, (spawner) =>
  make((command) => Effect.tap(spawner.spawn(command), () => receiveSighup)),
);

layer(Platform.layer, { excludeTestServices: true })("the signals of the process", (it) => {
  it.effect("reach a child when they arrive while Envi spawns it", () =>
    Effect.gen(function* () {
      const child = ChildProcess.make("node", ["-e", "setInterval(() => {}, 1000);"], {
        detached: false,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });

      const code = yield* Signals.supervise(child).pipe(
        Effect.provideService(ChildProcessSpawner, yield* signalDuringSpawn),
        Effect.provide(ProcessSignals.layer),
      );

      expect(code).toEqual(Option.some(sighupExitCode));
    }),
  );
});
