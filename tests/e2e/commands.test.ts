// `sync`, `inspect`, `check`, `export`, and `cache`: the text output, the JSON output, the exit
// codes, and the real files of each command.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  cacheFiles,
  fixture,
  makeSandbox,
  providerCalls,
  runCli,
  runtimes,
  type Sandbox,
  secrets,
} from "./helpers.ts";

const app = fixture("cached");

const workspace = fixture("workspace");

/** The secret values that a redacted output must not hold. `public-name` is not redacted. */
const hidden = [secrets["token-development"], secrets["db-password"], "line-one", "postgres://"];

const cli = (runtime: string, sandbox: Sandbox, args: ReadonlyArray<string>, cwd = app) =>
  runCli(runtime, cwd, ["--cache-dir", sandbox.cacheDirectory, ...args], sandbox.env);

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
    spawner.exitCode(
      ChildProcess.make("git", args, { cwd, stdout: "ignore", stderr: "ignore", stdin: "ignore" }),
    ),
  );

layer(NodeServices.layer, { excludeTestServices: true })("envi commands", (it) => {
  describe.each(runtimes)("on %s", (runtime) => {
    describe("sync", () => {
      it.effect("fills the cache and prints the counts without a value", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const result = yield* cli(runtime, sandbox, ["sync"]);

          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain("Synced the stage development from 1 config");
          expect(result.stdout).toContain("file: 7 secrets, 0 cached, 7 resolved");
          expect((yield* cacheFiles(sandbox.cacheDirectory)).length).toBe(7);

          for (const secret of hidden) {
            expect(result.stdout + result.stderr).not.toContain(secret);
          }
        }),
      );

      it.effect("finds every config of the workspace and calls a shared provider once", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const result = yield* cli(runtime, sandbox, ["sync", "--json"], workspace);
          const report = JSON.parse(result.stdout);

          expect(result.exitCode).toBe(0);
          expect(report.configs).toBe(2);
          expect(report.providers).toEqual([
            { provider: "file", secrets: 3, cached: 0, resolved: 3 },
          ]);
          expect(yield* providerCalls(sandbox)).toEqual([
            ["public-name", "shared", "token-development"],
          ]);
        }),
      );

      it.effect("syncs another stage with --stage", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const result = yield* cli(runtime, sandbox, ["--stage", "production", "sync", "--json"]);

          expect(JSON.parse(result.stdout).stage).toBe("production");
          expect((yield* providerCalls(sandbox))[0]).toContain("token-production");
        }),
      );

      it.effect("lists each failed var and exits with 1", () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const sandbox = yield* makeSandbox("none");
          const { "token-development": _token, ...rest } = secrets;

          yield* fs.writeFileString(sandbox.secretsFile, JSON.stringify(rest));

          const result = yield* cli(runtime, sandbox, ["sync", "--json"]);

          expect(result.exitCode).toBe(1);
          expect(JSON.parse(result.stdout).failures).toEqual([
            {
              key: "API_TOKEN",
              config: `${app}/envi.config.ts`,
              error: "SecretReferenceError",
              reason: "NotFound",
              reference: "file://token-development",
              summary:
                "Envi reference failed: NotFound for file://token-development (provider file)",
              hint: expect.stringContaining("existing secret"),
              docs: "https://github.com/kynnyhsap/envi#error-secret-reference-not-found",
            },
          ]);
        }),
      );
    });

    describe("check", () => {
      it.effect("validates every var and shows no value", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const result = yield* cli(runtime, sandbox, ["check"]);

          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain("✓ API_TOKEN");
          expect(result.stdout).toContain("✓ OPTIONAL");
          expect(result.stdout).not.toContain("✗");

          for (const secret of [...hidden, secrets["public-name"]]) {
            expect(result.stdout).not.toContain(secret);
          }
        }),
      );

      it.effect("reports a value that does not fit its schema, without the value", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");

          const result = yield* runCli(
            runtime,
            fixture("schema"),
            ["--no-cache", "check", "--json"],
            sandbox.env,
          );

          const report = JSON.parse(result.stdout);

          expect(result.exitCode).toBe(1);
          expect(report.passed).toEqual(["GOOD_PORT"]);
          expect(report.failures).toMatchObject([{ key: "BAD_PORT", error: "DecodeError" }]);
          expect(result.stdout + result.stderr).not.toContain("not-a-number");
        }),
      );
    });

    describe("inspect", () => {
      it.effect("hides each secret by default and shows the origin and the reference", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const result = yield* cli(runtime, sandbox, ["inspect"]);

          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain("Stage: development");
          expect(result.stdout).toMatch(
            /API_TOKEN\s+provider\s+file:\/\/token-development\s+<redacted>/u,
          );
          expect(result.stdout).toMatch(
            /PUBLIC_NAME\s+provider\s+file:\/\/public-name\s+public-app-name/u,
          );
          expect(result.stdout).toMatch(/PORT\s+literal\s+-\s+3000/u);
          expect(result.stdout).toMatch(/OPTIONAL\s+unset\s+file:\/\/absent\s+-/u);
          expect(result.stdout).toMatch(/WITH_DEFAULT\s+default/u);
          expect(result.stdout).toMatch(
            /DATABASE_URL\s+custom\s+custom\(database-url\)\s+<redacted>/u,
          );

          for (const secret of hidden) {
            expect(result.stdout).not.toContain(secret);
          }
        }),
      );

      it.effect("shows real values with --no-redact, and the JSON report with --json", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const shown = yield* cli(runtime, sandbox, ["inspect", "--no-redact"]);
          const json = yield* cli(runtime, sandbox, ["inspect", "--json"]);

          const token = JSON.parse(json.stdout).vars.find(
            (entry: { key: string }) => entry.key === "API_TOKEN",
          );

          expect(shown.stdout).toContain(secrets["token-development"]);
          expect(token).toMatchObject({
            origin: "cache",
            provider: "file",
            reference: "file://token-development",
            redacted: true,
            value: null,
          });
        }),
      );
    });

    describe("export", () => {
      it.effect("prints dotenv text with real values and correct quotes", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const result = yield* cli(runtime, sandbox, ["export"]);

          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain(`API_TOKEN=${secrets["token-development"]}\n`);
          expect(result.stdout).toContain("PORT=3000\n");
          expect(result.stdout).toContain(
            'PRIVATE_KEY="-----BEGIN FAKE KEY-----\\nline-one\\nline-two\\n-----END FAKE KEY-----"\n',
          );
          expect(result.stdout).not.toContain("OPTIONAL");
          expect(result.stderr).toBe("");
        }),
      );

      it.effect("prints JSON with --format json and with --json", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const byFormat = yield* cli(runtime, sandbox, ["export", "--format", "json"]);
          const byFlag = yield* cli(runtime, sandbox, ["export", "--json"]);

          expect(JSON.parse(byFormat.stdout)).toEqual(JSON.parse(byFlag.stdout));
          expect(JSON.parse(byFormat.stdout)).toMatchObject({
            PORT: "3000",
            PRIVATE_KEY: secrets["private-key"],
            WITH_DEFAULT: "fallback",
          });
        }),
      );

      it.effect("hides each secret with --redact", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const result = yield* cli(runtime, sandbox, ["export", "--redact"]);

          expect(result.stdout).toContain("PUBLIC_NAME=public-app-name");
          expect(result.stdout).toContain("PORT=3000");

          for (const secret of hidden) {
            expect(result.stdout).not.toContain(secret);
          }
        }),
      );

      it.effect("writes a private file with --output when git ignores the file", () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const sandbox = yield* makeSandbox("none");
          const project = path.join(sandbox.directory, "project");

          yield* fs.makeDirectory(project);
          yield* git(project, ["init", "--quiet"]);
          yield* fs.writeFileString(path.join(project, ".gitignore"), ".env.local\n");

          const ignored = path.join(project, ".env.local");
          const tracked = path.join(project, ".env.production");
          const written = yield* cli(runtime, sandbox, ["export", "--output", ignored]);
          const refused = yield* cli(runtime, sandbox, ["export", "--output", tracked]);

          expect(written.exitCode).toBe(0);
          expect(written.stdout).toBe("");
          expect(yield* fs.readFileString(ignored)).toContain(
            `API_TOKEN=${secrets["token-development"]}\n`,
          );
          expect((yield* fs.stat(ignored)).mode & 0o777).toBe(0o600);
          expect(refused.exitCode).toBe(1);
          expect(refused.stderr).toContain("git does not ignore");
          expect(yield* fs.exists(tracked)).toBe(false);
        }),
      );

      it.effect("writes a file outside a git repository", () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const sandbox = yield* makeSandbox("none");
          const file = path.join(sandbox.directory, "out.env");
          const result = yield* cli(runtime, sandbox, ["export", "--output", file]);

          expect(result.exitCode).toBe(0);
          expect(yield* fs.readFileString(file)).toContain("PORT=3000\n");
        }),
      );
    });

    describe("cache", () => {
      it.effect("prints the directory from --cache-dir and from ENVI_CACHE_DIR", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const byFlag = yield* cli(runtime, sandbox, ["cache", "path"]);

          const byVariable = yield* runCli(runtime, app, ["cache", "path", "--json"], {
            ENVI_CACHE_DIR: sandbox.cacheDirectory,
          });

          const disabled = yield* runCli(runtime, app, ["cache", "path"], {
            ENVI_CACHE_ENABLED: "false",
          });

          expect(byFlag.stdout.trim()).toBe(sandbox.cacheDirectory);
          expect(JSON.parse(byVariable.stdout)).toEqual({ directory: sandbox.cacheDirectory });
          expect(disabled.stdout).toContain("The cache is off.");
        }),
      );

      it.effect("lists the entries without a value, and clears them", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const empty = yield* cli(runtime, sandbox, ["cache", "list"]);

          yield* cli(runtime, sandbox, ["sync"]);

          const list = yield* cli(runtime, sandbox, ["cache", "list"]);
          const json = yield* cli(runtime, sandbox, ["cache", "list", "--json"]);
          const cleared = yield* cli(runtime, sandbox, ["cache", "clear", "--json"]);
          const after = yield* cli(runtime, sandbox, ["cache", "list", "--json"]);

          expect(empty.stdout).toContain("The cache holds no entry.");
          expect(list.stdout).toContain(`Directory: ${sandbox.cacheDirectory}`);
          expect(list.stdout).toContain("file://token-development");
          expect(list.stdout).toContain("custom(database-url)");
          expect(JSON.parse(json.stdout).entries.length).toBe(7);

          for (const secret of [...hidden, secrets["public-name"]]) {
            expect(list.stdout + json.stdout).not.toContain(secret);
          }

          expect(JSON.parse(cleared.stdout)).toMatchObject({ removed: 7 });
          expect(JSON.parse(after.stdout).entries).toEqual([]);
          expect(yield* cacheFiles(sandbox.cacheDirectory)).toEqual([]);
        }),
      );
    });
  });
});
