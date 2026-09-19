// `envi run`: the environment of the child, its exit code, and the signals.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { ChildProcess } from "effect/unstable/process";

import {
  cliPath,
  fixture,
  makeSandbox,
  providerCalls,
  runCli,
  runtimes,
  secrets,
} from "./helpers.ts";

const app = fixture("cached");

const printEnv = (names: ReadonlyArray<string>): string =>
  `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map((name) => [name, process.env[name] ?? null]))))`;

/** A child that reports that it runs, and then waits for a signal. */
const waitingChild = (handlesSignal: boolean): string =>
  [
    handlesSignal
      ? "process.on('SIGTERM', () => { console.log('child-got-SIGTERM'); process.exit(7); });"
      : "",
    "require('node:fs').writeFileSync(process.env.ENVI_E2E_READY_FILE, 'ready');",
    "setInterval(() => {}, 1000);",
  ].join("");

/** Starts `envi run`, sends SIGTERM to the Envi process alone, and returns the end of the run. */
const runAndTerminate = Effect.fn("runAndTerminate")(function* (
  runtime: string,
  handlesSignal: boolean,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sandbox = yield* makeSandbox("none");
  const readyFile = path.join(sandbox.directory, "ready");

  const handle = yield* ChildProcess.make(
    runtime,
    [
      cliPath,
      "--cache-dir",
      sandbox.cacheDirectory,
      "run",
      "--",
      "node",
      "-e",
      waitingChild(handlesSignal),
    ],
    {
      cwd: app,
      env: { ...sandbox.env, CI: undefined, ENVI_E2E_READY_FILE: readyFile },
      extendEnv: true,
    },
  );

  yield* fs
    .exists(readyFile)
    .pipe(
      Effect.repeat({ until: (exists) => exists, schedule: Schedule.spaced("50 millis") }),
      Effect.timeout("20 seconds"),
    );

  // The signal goes to the Envi process only. The child gets it through the forwarding.
  yield* Effect.sync(() => process.kill(Number(handle.pid), "SIGTERM"));

  const [exitCode, stdout] = yield* Effect.all(
    [handle.exitCode, Stream.mkString(Stream.decodeText(handle.stdout))],
    { concurrency: "unbounded" },
  );

  return { exitCode, stdout };
});

layer(NodeServices.layer, { excludeTestServices: true })("envi run", (it) => {
  describe.each(runtimes)("on %s", (runtime) => {
    it.effect("gives the child the parent environment plus the resolved vars", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");

        const names = [
          "API_TOKEN",
          "PORT",
          "NODE_ENV",
          "PRIVATE_KEY",
          "OPTIONAL",
          "WITH_DEFAULT",
          "DATABASE_URL",
          "FROM_PARENT",
          "ENVI_STAGE",
          "KEEP_ME",
          "OP_SERVICE_ACCOUNT_TOKEN",
          "ENVI_PROVIDER_EXAMPLE_TOKEN",
        ];

        const result = yield* runCli(
          runtime,
          app,
          [
            "--cache-dir",
            sandbox.cacheDirectory,
            "--stage",
            "production",
            "run",
            "--",
            "node",
            "-e",
            printEnv(names),
          ],
          {
            ...sandbox.env,
            API_TOKEN: "inherited-value",
            KEEP_ME: "kept",
            ENVI_E2E_PARENT: "from-parent-value",
            OP_SERVICE_ACCOUNT_TOKEN: "fake-token-that-must-not-leak",
            ENVI_PROVIDER_EXAMPLE_TOKEN: "fake-setting-that-must-not-leak",
          },
        );

        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          API_TOKEN: secrets["token-production"],
          PORT: "3000",
          NODE_ENV: "production",
          PRIVATE_KEY: secrets["private-key"],
          OPTIONAL: null,
          WITH_DEFAULT: "fallback",
          DATABASE_URL: "postgres://app:db-pass-value@db.invalid/app",
          FROM_PARENT: "from-parent-value",
          ENVI_STAGE: "production",
          KEEP_ME: "kept",
          OP_SERVICE_ACCOUNT_TOKEN: null,
          ENVI_PROVIDER_EXAMPLE_TOKEN: null,
        });
      }),
    );

    it.effect("returns the exit code of the child", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");

        const result = yield* runCli(
          runtime,
          app,
          ["--cache-dir", sandbox.cacheDirectory, "run", "--", "node", "-e", "process.exit(42)"],
          sandbox.env,
        );

        expect(result.exitCode).toBe(42);
      }),
    );

    it.effect("passes flags after -- to the child and not to Envi", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");

        const result = yield* runCli(
          runtime,
          app,
          [
            "--cache-dir",
            sandbox.cacheDirectory,
            "run",
            "--",
            "node",
            "-e",
            "console.log(process.argv.slice(1).join(' '))",
            "--",
            "--stage",
            "--json",
          ],
          sandbox.env,
        );

        expect(result.stdout.trim()).toBe("--stage --json");
      }),
    );

    it.effect("starts no child when a var fails", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const sandbox = yield* makeSandbox("none");

        yield* fs.writeFileString(sandbox.secretsFile, JSON.stringify({ "db-user": "app" }));

        const result = yield* runCli(
          runtime,
          app,
          ["--no-cache", "run", "--", "node", "-e", "console.log('child-started')"],
          sandbox.env,
        );

        expect(result.exitCode).toBe(1);
        expect(result.stdout).not.toContain("child-started");
        expect(result.stderr).toContain("NotFound");
        expect(result.stderr).toContain("file://");
      }),
    );

    it.effect("reports a command that does not exist", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");

        const result = yield* runCli(
          runtime,
          app,
          ["--cache-dir", sandbox.cacheDirectory, "run", "--", "envi-e2e-no-such-command"],
          sandbox.env,
        );

        expect(result.exitCode).toBe(1);
        // Node reports EACCES in place of ENOENT when a folder of `PATH` is not readable.
        expect(result.stderr).toMatch(/CommandNotFound|CommandNotExecutable/u);
        expect(result.stderr).toContain("envi-e2e-no-such-command");
      }),
    );

    it.effect("reads the cache on the second run", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const args = ["--cache-dir", sandbox.cacheDirectory, "run", "--", "node", "-e", ""];

        yield* runCli(runtime, app, args, sandbox.env);
        yield* runCli(runtime, app, args, sandbox.env);

        expect((yield* providerCalls(sandbox))[1]).toEqual(["absent", "uncached"]);
      }),
    );

    it.effect("forwards SIGTERM to the child and returns the exit code of the child", () =>
      Effect.gen(function* () {
        const result = yield* runAndTerminate(runtime, true);

        expect(result.stdout).toContain("child-got-SIGTERM");
        expect(result.exitCode).toBe(7);
      }),
    );

    it.effect("returns 143 when SIGTERM ends a child without a handler", () =>
      Effect.gen(function* () {
        const result = yield* runAndTerminate(runtime, false);

        expect(result.exitCode).toBe(143);
      }),
    );
  });
});
