// `sync`, `inspect`, `check`, `export`, and `cache`: the text output, the JSON output, the exit
// codes, and the real files of each command.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import {
  CacheClearReport,
  CacheListReport,
  CachePathReport,
  CheckReport,
  InspectReport,
  SyncReport,
} from "@kynnyhsap/envi";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  cacheFiles,
  decodeJson,
  docsOf,
  ExportedVars,
  fixture,
  gitInit,
  hiddenSecrets,
  makeSandbox,
  providerCalls,
  providerInteractive,
  runCli,
  cliPath,
  runProcess,
  runtimes,
  type Sandbox,
  secrets,
} from "./helpers.ts";

const app = fixture("cached");

/** The longest file name of macOS and Linux, in bytes. */
const longestName = 255;

const workspace = fixture("workspace");

/** Two configs with two default stages. */
const stages = fixture("stages");

/** Runs a command on the cache of the sandbox. A flag follows the name of its command. */
const cli = (runtime: string, sandbox: Sandbox, args: ReadonlyArray<string>, cwd = app) => {
  const name = args[0] === "cache" ? 2 : 1;

  return runCli(
    runtime,
    cwd,
    [...args.slice(0, name), "--cache-dir", sandbox.cacheDirectory, ...args.slice(name)],
    sandbox.env,
  );
};

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

          for (const secret of hiddenSecrets) {
            expect(result.stdout + result.stderr).not.toContain(secret);
          }
        }),
      );

      it.effect("finds every config below the folder and calls a shared provider once", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");

          const result = yield* cli(
            runtime,
            sandbox,
            ["sync", "--config-search", "down", "--json"],
            workspace,
          );

          const report = yield* decodeJson(SyncReport, result.stdout);

          expect(result.exitCode).toBe(0);
          expect(report.configs).toBe(2);
          expect(report.cache).toBe(true);
          expect(report.providers).toEqual([
            { provider: "file", secrets: 3, cached: 0, resolved: 3 },
          ]);
          expect(yield* providerCalls(sandbox)).toEqual([
            ["public-name", "shared", "token-development"],
          ]);
        }),
      );

      it.effect("says that the cache is off in CI", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const inCi = { ...sandbox, env: { ...sandbox.env, CI: "true" } };
          const text = yield* cli(runtime, inCi, ["sync"]);
          const json = yield* cli(runtime, inCi, ["sync", "--json"]);

          expect(text.stdout).toContain("The cache is off");
          expect((yield* decodeJson(SyncReport, json.stdout)).cache).toBe(false);
          expect(yield* cacheFiles(sandbox.cacheDirectory)).toEqual([]);
        }),
      );

      it.effect("syncs another stage with --stage", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const result = yield* cli(runtime, sandbox, ["sync", "--stage", "production", "--json"]);

          expect((yield* decodeJson(SyncReport, result.stdout)).stages).toEqual(["production"]);
          expect((yield* providerCalls(sandbox))[0]).toContain("token-production");
        }),
      );

      it.effect("reports every stage of configs with different default stages", () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const sandbox = yield* makeSandbox("none");
          const web = path.join(stages, "web/envi.config.ts");
          const api = path.join(stages, "api/envi.config.ts");
          const configs = ["--config", web, "--config", api];
          // The default stages of the web config and the api config, in this order.
          const defaultStages = ["development", "production"];
          const text = yield* cli(runtime, sandbox, ["sync", ...configs]);
          const json = yield* cli(runtime, sandbox, ["sync", ...configs, "--json"]);

          const one = yield* cli(runtime, sandbox, [
            "sync",
            ...configs,
            "--stage",
            "development",
            "--json",
          ]);

          expect(text.stdout).toContain(
            `Synced the stages ${defaultStages.join(", ")} from ${defaultStages.length} configs`,
          );
          expect((yield* decodeJson(SyncReport, json.stdout)).stages).toEqual(defaultStages);
          expect((yield* decodeJson(SyncReport, one.stdout)).stages).toEqual(["development"]);
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
          expect((yield* decodeJson(SyncReport, result.stdout)).failures).toEqual([
            {
              key: "API_TOKEN",
              config: `${app}/envi.config.ts`,
              error: "SecretReferenceError",
              reason: "NotFound",
              reference: "file://token-development",
              summary:
                "Envi reference failed: NotFound for file://token-development (provider file)",
              hint: expect.stringContaining("existing secret"),
              docs: docsOf("secret-reference-not-found"),
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

          for (const secret of [...hiddenSecrets, secrets["public-name"]]) {
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
            ["check", "--no-cache", "--json"],
            sandbox.env,
          );

          const report = yield* decodeJson(CheckReport, result.stdout);

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

          for (const secret of hiddenSecrets) {
            expect(result.stdout).not.toContain(secret);
          }
        }),
      );

      it.effect("shows real values with --no-redact, and the JSON report with --json", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const shown = yield* cli(runtime, sandbox, ["inspect", "--no-redact"]);
          const json = yield* cli(runtime, sandbox, ["inspect", "--json"]);

          const { vars } = yield* decodeJson(InspectReport, json.stdout);
          const token = vars.find((entry) => entry.key === "API_TOKEN");

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

          const exported = yield* decodeJson(ExportedVars, byFormat.stdout);

          expect(yield* decodeJson(ExportedVars, byFlag.stdout)).toEqual(exported);
          expect(exported).toMatchObject({
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

          for (const secret of hiddenSecrets) {
            expect(result.stdout).not.toContain(secret);
          }
        }),
      );

      it.effect("makes a readable file that git tracks private with --output", () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const sandbox = yield* makeSandbox("none");
          const project = path.join(sandbox.directory, "project");
          const tracked = path.join(project, ".env.production");
          const oldContent = "API_TOKEN=old-token\n";

          yield* fs.makeDirectory(project);
          yield* gitInit(project);
          yield* fs.writeFileString(tracked, oldContent);
          yield* fs.chmod(tracked, 0o644);
          yield* runProcess("git", ["add", tracked], project);

          const listed = yield* runProcess(
            "git",
            ["ls-files", "--error-unmatch", tracked],
            project,
          );

          expect(listed.exitCode).toBe(0);
          expect((yield* fs.stat(tracked)).mode & 0o777).toBe(0o644);

          const written = yield* cli(runtime, sandbox, ["export", "--output", tracked]);
          const text = yield* fs.readFileString(tracked);

          expect(written.exitCode).toBe(0);
          expect(written.stdout).toBe("");
          expect(text).toContain(`API_TOKEN=${secrets["token-development"]}\n`);
          expect(text).not.toContain(oldContent);
          expect((yield* fs.stat(tracked)).mode & 0o777).toBe(0o600);
        }),
      );

      it.effect("writes a file outside a git repository", () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const sandbox = yield* makeSandbox("none");
          const folder = path.join(sandbox.directory, "out");
          const file = path.join(folder, "out.env");

          yield* fs.makeDirectory(folder);

          const result = yield* cli(runtime, sandbox, ["export", "--output", file]);

          expect(result.exitCode).toBe(0);
          expect(yield* fs.readFileString(file)).toContain("PORT=3000\n");
          expect((yield* fs.stat(file)).mode & 0o777).toBe(0o600);
          expect(yield* fs.readDirectory(folder)).toEqual(["out.env"]);
        }),
      );

      it.effect.each(["0200", "0400"])(
        "writes a readable private file under the umask %s",
        (mask) =>
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const sandbox = yield* makeSandbox("none");
            const file = path.join(sandbox.directory, "out.env");

            const result = yield* runProcess(
              "sh",
              [
                "-c",
                `umask ${mask} && exec "$@"`,
                "sh",
                runtime,
                cliPath,
                "export",
                "--no-cache",
                "--output",
                file,
              ],
              app,
              sandbox.env,
            );

            expect(result.exitCode).toBe(0);
            expect((yield* fs.stat(file)).mode & 0o777).toBe(0o600);
            expect(yield* fs.readFileString(file)).toContain("PORT=3000\n");
          }),
      );

      it.effect.each([
        { name: "a relative path", pointer: "target.env", absolute: false, target: "target.env" },
        { name: "an absolute path", pointer: "target.env", absolute: true, target: "target.env" },
        {
          name: "../ after a linked folder",
          pointer: "alias/../target.env",
          absolute: false,
          target: "real/target.env",
        },
      ])("keeps a dangling link to $name and creates the file that it points to", (link) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const sandbox = yield* makeSandbox("none");
          const real = path.join(sandbox.directory, "real");
          const file = path.join(sandbox.directory, "link.env");
          const target = path.join(sandbox.directory, link.target);
          const pointer = link.absolute ? path.join(sandbox.directory, link.pointer) : link.pointer;
          const collapsed = path.join(sandbox.directory, "target.env");

          // The OS follows `alias` before `..`, so `alias/../target.env` is in `real`. A file at
          // the path without `alias/..` must stay as it is.
          yield* fs.makeDirectory(path.join(real, "sub"), { recursive: true });
          yield* fs.symlink(path.join(real, "sub"), path.join(sandbox.directory, "alias"));
          yield* fs.symlink(pointer, file);

          if (target !== collapsed) {
            yield* fs.writeFileString(collapsed, "PORT=1\n");
          }

          const result = yield* cli(runtime, sandbox, ["export", "--output", file]);

          expect(result.exitCode).toBe(0);
          expect(yield* fs.readLink(file)).toBe(pointer);
          expect(yield* fs.readFileString(target)).toContain("PORT=3000\n");
          expect((yield* fs.stat(target)).mode & 0o777).toBe(0o600);
          expect(yield* fs.readDirectory(real)).toEqual(
            target === collapsed ? ["sub"] : ["sub", "target.env"],
          );

          if (target !== collapsed) {
            expect(yield* fs.readFileString(collapsed)).toBe("PORT=1\n");
          }
        }),
      );

      it.effect(
        "writes an output path with ../ after a linked folder where the OS resolves it",
        () =>
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const sandbox = yield* makeSandbox("none");
            const real = path.join(sandbox.directory, "real");

            yield* fs.makeDirectory(path.join(real, "sub"), { recursive: true });
            yield* fs.symlink(path.join(real, "sub"), path.join(sandbox.directory, "alias"));

            // A file at the path without `alias/..` must stay as it is.
            const collapsed = path.join(sandbox.directory, "out.env");

            yield* fs.writeFileString(collapsed, "PORT=1\n");

            // A plain string, because `path.join` would remove `alias/..`.
            const output = `${sandbox.directory}/alias/../out.env`;
            const result = yield* cli(runtime, sandbox, ["export", "--output", output]);

            expect(result.exitCode).toBe(0);
            expect(yield* fs.readFileString(path.join(real, "out.env"))).toContain("PORT=3000\n");
            expect(yield* fs.readFileString(collapsed)).toBe("PORT=1\n");
          }),
      );

      it.effect("writes a file whose name has the longest length that the OS allows", () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const sandbox = yield* makeSandbox("none");
          const folder = path.join(sandbox.directory, "out");
          const file = path.join(folder, `${"x".repeat(longestName - ".env".length)}.env`);

          yield* fs.makeDirectory(folder);

          const result = yield* cli(runtime, sandbox, ["export", "--output", file]);

          expect(result.exitCode).toBe(0);
          expect(yield* fs.readFileString(file)).toContain("PORT=3000\n");
          expect(yield* fs.readDirectory(folder)).toEqual([path.basename(file)]);
        }),
      );

      it.effect("writes the file that a symlink points to, and keeps the link", () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const sandbox = yield* makeSandbox("none");
          const target = path.join(sandbox.directory, "target.env");
          const link = path.join(sandbox.directory, "link.env");

          yield* fs.writeFileString(target, "PORT=1\n");
          yield* fs.chmod(target, 0o644);
          yield* fs.symlink(target, link);

          const result = yield* cli(runtime, sandbox, ["export", "--output", link]);

          expect(result.exitCode).toBe(0);
          expect(yield* fs.readLink(link)).toBe(target);
          expect(yield* fs.readFileString(target)).toContain("PORT=3000\n");
          expect((yield* fs.stat(target)).mode & 0o777).toBe(0o600);
        }),
      );
    });

    describe("interactive", () => {
      it.effect("allows a prompt outside CI, forbids it in CI, and the flags win", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const inCi = { ...sandbox.env, CI: "true" };

          const check = (args: ReadonlyArray<string>, env: Readonly<Record<string, string>>) =>
            runCli(runtime, app, ["check", "--no-cache", ...args], env);

          yield* check([], sandbox.env);
          yield* check([], inCi);
          yield* check(["--interactive"], inCi);
          yield* check(["--no-interactive"], sandbox.env);

          expect(yield* providerInteractive(sandbox)).toEqual([true, false, true, false]);
        }),
      );
    });

    describe("cache", () => {
      it.effect("prints the directory from --cache-dir and ENVI_CACHE_DIR, also in CI", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const byFlag = yield* cli(runtime, sandbox, ["cache", "path"]);

          const byVariable = yield* runCli(runtime, app, ["cache", "path", "--json"], {
            ENVI_CACHE_DIR: sandbox.cacheDirectory,
          });

          const inCi = yield* runCli(runtime, app, ["cache", "path"], {
            ENVI_CACHE_DIR: sandbox.cacheDirectory,
            ENVI_CACHE_ENABLED: "false",
            CI: "true",
          });

          expect(byFlag.stdout.trim()).toBe(sandbox.cacheDirectory);
          expect(yield* decodeJson(CachePathReport, byVariable.stdout)).toEqual({
            directory: sandbox.cacheDirectory,
          });
          expect(inCi.stdout.trim()).toBe(sandbox.cacheDirectory);
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
          expect((yield* decodeJson(CacheListReport, json.stdout)).entries.length).toBe(7);

          for (const secret of [...hiddenSecrets, secrets["public-name"]]) {
            expect(list.stdout + json.stdout).not.toContain(secret);
          }

          expect(yield* decodeJson(CacheClearReport, cleared.stdout)).toEqual({ removed: 7 });
          expect((yield* decodeJson(CacheListReport, after.stdout)).entries).toEqual([]);
          expect(yield* cacheFiles(sandbox.cacheDirectory)).toEqual([]);
        }),
      );

      it.effect("lists and clears the entries in CI, where the cache is off", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");
          const inCi = { ...sandbox, env: { ...sandbox.env, CI: "true" } };

          yield* cli(runtime, sandbox, ["sync"]);

          const list = yield* cli(runtime, inCi, ["cache", "list", "--json"]);
          const cleared = yield* cli(runtime, inCi, ["cache", "clear", "--json"]);

          expect((yield* decodeJson(CacheListReport, list.stdout)).entries.length).toBe(7);
          expect(yield* decodeJson(CacheClearReport, cleared.stdout)).toEqual({ removed: 7 });
          expect(yield* cacheFiles(sandbox.cacheDirectory)).toEqual([]);
        }),
      );
    });
  });
});
