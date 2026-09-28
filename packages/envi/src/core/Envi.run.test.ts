import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { defineConfig } from "./Config.ts";
import * as Envi from "./Envi.ts";
import { RunError, RunFailure } from "./Errors.ts";
import { enviLayer, exitedProcess } from "./fixtures/Support.ts";
import { mem, memoryProvider } from "./Memory.ts";
import * as Provider from "./Provider.ts";

const spawned: Array<ChildProcess.StandardCommand> = [];

/** The commands that the test spawner fails to start, with the error of the OS. */
const unstartable = new Map<string, PlatformError.SystemErrorTag>([
  ["nope", "NotFound"],
  ["locked", "PermissionDenied"],
  ["broken", "BadResource"],
]);

/** A spawner that records each command and exits with the code 7, except an unstartable one. */
const spawner = ChildProcessSpawner.make((command) => {
  if (!ChildProcess.isStandardCommand(command)) {
    return Effect.die("the test spawner accepts only a standard command");
  }

  const spawnError = unstartable.get(command.command);

  if (spawnError !== undefined) {
    return Effect.fail(
      PlatformError.systemError({ _tag: spawnError, module: "ChildProcess", method: "spawn" }),
    );
  }

  spawned.push(command);

  return Effect.succeed(exitedProcess(7));
});

const parent = {
  PATH: "/usr/bin",
  TOKEN: "inherited",
  VAULT_TOKEN: "vault-secret",
  ENVI_PROVIDER_ONEPASSWORD_ACCOUNT: "my-team",
  ENVI_STAGE: "development",
};

const layer = Layer.mergeAll(
  enviLayer(),
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
  Layer.succeed(Envi.ParentEnvironment, parent),
);

/** A provider with a credential variable. `run` removes the variable from the child. */
const vault = Provider.make({
  id: "vault",
  scope: "vault",
  credentialVariables: ["VAULT_TOKEN"],
  resolveMany: () => Effect.succeed({}),
  helpers: {},
});

const config = defineConfig({
  stages: ["development", "production"],
  providers: [memoryProvider({ token: "resolved" }), vault],
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

  it.effect.each([
    ["nope", RunFailure.CommandNotFound],
    ["locked", RunFailure.CommandNotExecutable],
    ["broken", RunFailure.SpawnFailed],
  ] as const)("reports %s as %s without its arguments", ([command, reason]) =>
    Effect.gen(function* () {
      const envi = yield* Envi.Envi;
      const error = yield* Effect.flip(envi.run(config, command, ["--token", "abc"]));

      expect(error).toBeInstanceOf(RunError);
      expect(error).toMatchObject({ reason, command });
      expect(error.message).not.toContain("abc");
    }).pipe(Effect.provide(layer)),
  );
});
