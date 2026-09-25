import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as Cache from "./Cache.ts";
import { defineConfig } from "./Config.ts";
import * as Envi from "./Envi.ts";
import { RunError, RunFailure, SecretReferenceError, VarsError } from "./Errors.ts";
import { mem, memoryProvider } from "./Memory.ts";

const spawned: Array<ChildProcess.StandardCommand> = [];

/** A spawner that records each command and exits with the code 7. The command `nope` is missing. */
const spawner = ChildProcessSpawner.make((command) => {
  if (!ChildProcess.isStandardCommand(command)) {
    return Effect.die("the test spawner accepts only a standard command");
  }

  if (command.command === "nope") {
    return Effect.fail(
      // The `_tag` is the input of the constructor of Effect. No other constructor exists.
      // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction
      PlatformError.systemError({ _tag: "NotFound", module: "ChildProcess", method: "spawn" }),
    );
  }

  spawned.push(command);

  return Effect.succeed(
    ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(1),
      exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(7)),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      stdin: Sink.drain,
      stdout: Stream.empty,
      stderr: Stream.empty,
      all: Stream.empty,
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void),
    }),
  );
});

const parent = {
  PATH: "/usr/bin",
  TOKEN: "inherited",
  OP_SERVICE_ACCOUNT_TOKEN: "ops_secret",
  ENVI_PROVIDER_ONEPASSWORD_ACCOUNT: "my-team",
  ENVI_STAGE: "development",
};

const layer = Layer.mergeAll(
  Layer.provide(Envi.layer(), Cache.layerMemory),
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
  Layer.succeed(Envi.ParentEnvironment, parent),
);

const config = defineConfig({
  stages: ["development", "production"],
  providers: [memoryProvider({ token: "resolved" })],
  vars: { TOKEN: mem("token"), PORT: "3000", SENTRY_DSN: mem("sentry").optional() },
});

describe("Envi.run", () => {
  it.effect("starts the child with the parent environment plus the resolved vars", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;

      const report = yield* envi.run(config, "bun", ["run", "dev"], {
        stage: "production",
        cwd: "/work/app",
      });

      const command = spawned.at(-1);

      expect(report).toEqual({ exitCode: 7 });
      expect(command?.command).toBe("bun");
      expect(command?.args).toEqual(["run", "dev"]);
      expect(command?.options.cwd).toBe("/work/app");
      expect(command?.options.extendEnv).toBe(false);
      expect(command?.options.stdin).toBe("inherit");
      expect(command?.options.stdout).toBe("inherit");
      expect(command?.options.stderr).toBe("inherit");
      expect(command?.options.env).toEqual({
        PATH: "/usr/bin",
        TOKEN: "resolved",
        PORT: "3000",
        ENVI_STAGE: "production",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("starts no child when a var fails", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const before = spawned.length;

      const broken = defineConfig({
        providers: [memoryProvider({})],
        vars: { TOKEN: mem("token") },
      });

      const error = yield* Effect.flip(envi.run(broken, "bun", ["run", "dev"]));

      assert(error instanceof VarsError);
      expect(error.failures[0]?.error).toBeInstanceOf(SecretReferenceError);
      expect(spawned.length).toBe(before);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reports a missing command without its arguments", () =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const error = yield* Effect.flip(envi.run(config, "nope", ["--token", "abc"]));

      expect(error).toBeInstanceOf(RunError);
      expect(error).toMatchObject({ reason: RunFailure.CommandNotFound, command: "nope" });
      expect(error.message).not.toContain("abc");
    }).pipe(Effect.provide(layer)),
  );
});
