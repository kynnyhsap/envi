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

const signalNumbers = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as const;

type SignalName = keyof typeof signalNumbers;

const signalNames: ReadonlyArray<SignalName> = ["SIGTERM", "SIGINT", "SIGHUP"];

/**
 * A child that reports that it runs, and then waits for a signal. With a handler, it counts the
 * signals for a short time, prints the count, and exits with 7.
 */
const waitingChild = (handled: SignalName | undefined): string =>
  [
    handled === undefined
      ? ""
      : `let count = 0; process.on('${handled}', () => { count += 1; setTimeout(() => { console.log('child-got-${handled}=' + count); process.exit(7); }, 300); });`,
    "require('node:fs').writeFileSync(process.env.ENVI_E2E_READY_FILE, 'ready');",
    "setInterval(() => {}, 1000);",
  ].join("");

const waitForFile = (file: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs
      .exists(file)
      .pipe(
        Effect.repeat({ until: (exists) => exists, schedule: Schedule.spaced("50 millis") }),
        Effect.timeout("20 seconds"),
      ),
  );

/** Starts `envi run`, sends a signal to the Envi process alone, and returns the end of the run. */
const runAndSignal = Effect.fn("runAndSignal")(function* (
  runtime: string,
  signal: SignalName,
  hasHandler: boolean,
) {
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
      waitingChild(hasHandler ? signal : undefined),
    ],
    {
      cwd: app,
      env: { ...sandbox.env, CI: undefined, ENVI_E2E_READY_FILE: readyFile },
      extendEnv: true,
    },
  );

  yield* waitForFile(readyFile);

  // The signal goes to the Envi process only. The child gets it through the forwarding.
  yield* Effect.sync(() => process.kill(Number(handle.pid), signal));

  const [exitCode, stdout] = yield* Effect.all(
    [handle.exitCode, Stream.mkString(Stream.decodeText(handle.stdout))],
    { concurrency: "unbounded" },
  );

  return { exitCode, stdout };
});

/**
 * Waits for the child, types Ctrl-C, and keeps the input open, because `script` ends at the end
 * of its input. The input is a shell pipe, because `script` rejects the socket that Node gives
 * to a child as stdin.
 */
const pressControlC = [
  '(while [ ! -f "$ENVI_E2E_READY_FILE" ]; do sleep 0.1; done; sleep 0.2; printf "\\003"; sleep 2)',
  'script -q /dev/null "$@"',
].join(" | ");

/**
 * Starts `envi run` under a pseudo terminal through the BSD `script` command, and types Ctrl-C.
 * The terminal sends SIGINT to the whole foreground process group: to Envi and to the child.
 */
const runAndPressControlC = Effect.fn("runAndPressControlC")(function* (runtime: string) {
  const path = yield* Path.Path;
  const sandbox = yield* makeSandbox("none");
  const readyFile = path.join(sandbox.directory, "ready");

  const handle = yield* ChildProcess.make(
    "sh",
    [
      "-c",
      pressControlC,
      "sh",
      runtime,
      cliPath,
      "--cache-dir",
      sandbox.cacheDirectory,
      "run",
      "--",
      "node",
      "-e",
      waitingChild("SIGINT"),
    ],
    {
      cwd: app,
      env: { ...sandbox.env, CI: undefined, ENVI_E2E_READY_FILE: readyFile },
      extendEnv: true,
      stdin: "ignore",
    },
  );

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
          "ENVI_E2E_FILE_TOKEN",
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
            ENVI_E2E_FILE_TOKEN: "fake-token-that-must-not-leak",
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
          ENVI_E2E_FILE_TOKEN: null,
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

        // A cached `NotFound` serves the optional vars, so only the uncached var calls again.
        expect((yield* providerCalls(sandbox))[1]).toEqual(["uncached"]);
      }),
    );

    describe.each(signalNames)("with %s", (signal) => {
      it.effect("forwards the signal once, and returns the exit code of the child", () =>
        Effect.gen(function* () {
          const result = yield* runAndSignal(runtime, signal, true);

          expect(result.stdout).toContain(`child-got-${signal}=1`);
          expect(result.exitCode).toBe(7);
        }),
      );

      it.effect("returns 128 plus the signal number for a child without a handler", () =>
        Effect.gen(function* () {
          const result = yield* runAndSignal(runtime, signal, false);

          expect(result.exitCode).toBe(128 + signalNumbers[signal]);
        }),
      );
    });

    it.effect.skipIf(process.platform !== "darwin")(
      "gives the child one SIGINT for Ctrl-C in a real terminal",
      () =>
        Effect.gen(function* () {
          const result = yield* runAndPressControlC(runtime);

          expect(result.stdout).toContain("child-got-SIGINT=1");
          expect(result.exitCode).toBe(7);
        }),
    );
  });
});
