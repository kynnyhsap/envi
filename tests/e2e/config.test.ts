// Config loading, the global flags, the install hint, and the delegation to a local `envi`.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { ChildProcess } from "effect/unstable/process";
import { fileURLToPath } from "node:url";

import { fixture, makeSandbox, runCli, runtimes } from "./helpers.ts";

const app = fixture("cached");

const workspace = fixture("workspace");

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const enviPackage = fileURLToPath(new URL("../../packages/envi", import.meta.url));

const globalVersion = "9.9.9-global";

layer(NodeServices.layer, { excludeTestServices: true })("envi config and flags", (it) => {
  describe.each(runtimes)("on %s", (runtime) => {
    it.effect("uses the nearest config above the working directory", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");

        const result = yield* runCli(
          runtime,
          fixture("cached/sub"),
          ["--no-cache", "check", "--json"],
          sandbox.env,
        );

        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout).passed).toContain("API_TOKEN");
      }),
    );

    it.effect("takes several configs from --config and from ENVI_CONFIG", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const sandbox = yield* makeSandbox("none");
        const api = path.join(workspace, "packages/api/envi.config.ts");
        const web = path.join(workspace, "packages/web/envi.config.ts");

        const byFlag = yield* runCli(
          runtime,
          sandbox.directory,
          ["--no-cache", "--config", api, "--config", web, "sync", "--json"],
          sandbox.env,
        );

        const byVariable = yield* runCli(
          runtime,
          sandbox.directory,
          ["--no-cache", "sync", "--json"],
          { ...sandbox.env, ENVI_CONFIG: `${api}, ${web}` },
        );

        expect(JSON.parse(byFlag.stdout).configs).toBe(2);
        expect(JSON.parse(byVariable.stdout).configs).toBe(2);
      }),
    );

    it.effect("rejects several configs for a command that uses one config", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const sandbox = yield* makeSandbox("none");
        const api = path.join(workspace, "packages/api/envi.config.ts");
        const web = path.join(workspace, "packages/web/envi.config.ts");

        const result = yield* runCli(
          runtime,
          sandbox.directory,
          ["--config", api, "--config", web, "check"],
          sandbox.env,
        );

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("This command uses one config.");
      }),
    );

    it.effect("reports a config file with a wrong extension and a file that does not exist", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const sandbox = yield* makeSandbox("none");

        const extension = yield* runCli(runtime, app, [
          "--config",
          path.join(workspace, "package.json"),
          "check",
        ]);

        const missing = yield* runCli(runtime, app, [
          "--config",
          path.join(sandbox.directory, "nope.config.ts"),
          "check",
        ]);

        expect(extension.exitCode).toBe(1);
        expect(extension.stderr).toContain("InvalidConfig");
        expect(missing.exitCode).toBe(1);
        expect(missing.stderr).toContain("NotFound");
      }),
    );

    it.effect("reports the location of a syntax error without the source text", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sandbox = yield* makeSandbox("none");

        yield* fs.writeFileString(
          path.join(sandbox.directory, "envi.config.ts"),
          'export default {\n  vars: {\n    TOKEN: "secret-in-source" +\n  },\n};\n',
        );

        const text = yield* runCli(runtime, sandbox.directory, ["check"]);
        const json = yield* runCli(runtime, sandbox.directory, ["check", "--json"]);

        expect(text.exitCode).toBe(1);
        expect(text.stderr).toContain("ConfigSyntax");
        expect(text.stderr).toMatch(/envi\.config\.ts:4/u);
        expect(text.stderr).toContain(
          "docs: https://github.com/kynnyhsap/envi#error-config-load-config-syntax",
        );
        expect(text.stderr + json.stdout).not.toContain("secret-in-source");
        expect(json.exitCode).toBe(1);
        expect(JSON.parse(json.stdout).error).toMatchObject({
          error: "ConfigLoadError",
          reason: "ConfigSyntax",
        });
      }),
    );

    it.effect("prints the install hint for a project without a local Envi", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sandbox = yield* makeSandbox("none");

        yield* fs.writeFileString(
          path.join(sandbox.directory, "envi.config.ts"),
          'import { defineConfig } from "envi";\n\nexport default defineConfig({ vars: { A: "1" } });\n',
        );

        const result = yield* runCli(runtime, sandbox.directory, ["check"]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("MissingDependency");
        expect(result.stderr).toContain("Install Envi");
      }),
    );

    it.effect("starts the local Envi of the project from a global Envi", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        // A second copy of the built package stands for the global installation. It sits in
        // `node_modules` of the repo, so its imports resolve. Only its version differs.
        const globalCopy = yield* fs.makeTempDirectoryScoped({
          directory: path.join(repoRoot, "node_modules"),
          prefix: ".e2e-global-",
        });

        const manifest = yield* fs.readFileString(path.join(enviPackage, "package.json"));

        yield* fs.copy(path.join(enviPackage, "dist"), path.join(globalCopy, "dist"));
        yield* fs.writeFileString(
          path.join(globalCopy, "package.json"),
          JSON.stringify({ ...JSON.parse(manifest), version: globalVersion }),
        );

        const runGlobal = (env: Readonly<Record<string, string>>) =>
          Effect.gen(function* () {
            const handle = yield* ChildProcess.make(
              runtime,
              [path.join(globalCopy, "dist/bin.js"), "--version"],
              { cwd: app, env, extendEnv: true },
            );

            return yield* Stream.mkString(Stream.decodeText(handle.stdout));
          });

        const delegated = yield* runGlobal({});
        const marked = yield* runGlobal({ ENVI_DELEGATED: "1" });

        const outside = yield* Effect.gen(function* () {
          const handle = yield* ChildProcess.make(
            runtime,
            [path.join(globalCopy, "dist/bin.js"), "--version"],
            { cwd: "/", extendEnv: true },
          );

          return yield* Stream.mkString(Stream.decodeText(handle.stdout));
        });

        // In the project, the global Envi starts the local Envi. The marker stops a loop.
        expect(delegated).toContain("0.0.0");
        expect(marked).toContain(globalVersion);
        expect(outside).toContain(globalVersion);
      }),
    );

    it.effect("keeps the delegation marker out of the child of run", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");

        const result = yield* runCli(
          runtime,
          app,
          [
            "--no-cache",
            "run",
            "--",
            "node",
            "-e",
            "console.log(`delegated=${process.env.ENVI_DELEGATED}`)",
          ],
          { ...sandbox.env, ENVI_DELEGATED: "1" },
        );

        expect(result.stdout).toContain("delegated=undefined");
      }),
    );

    it.effect("writes every log to stderr, as logfmt or as JSON", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");

        const args = [
          "--cache-dir",
          sandbox.cacheDirectory,
          "--debug",
          "export",
          "--format",
          "json",
        ];

        const pretty = yield* runCli(runtime, app, args, sandbox.env);

        const json = yield* runCli(
          runtime,
          app,
          [...args, "--refresh", "--log-format", "json"],
          sandbox.env,
        );

        const firstLog = json.stderr.split("\n").find((line) => line.trim() !== "");

        expect(() => JSON.parse(pretty.stdout)).not.toThrow();
        expect(pretty.stderr).toContain("level=DEBUG");
        expect(JSON.parse(firstLog ?? "")).toMatchObject({ level: "DEBUG" });
        expect(pretty.stderr + json.stderr).not.toContain("dev-token-value");
      }),
    );

    it.effect("logs the duration of every command and of every step with --debug", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const cached = ["--cache-dir", sandbox.cacheDirectory, "--debug"];

        const commands: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
          ["sync", ["sync"]],
          ["check", ["check"]],
          ["inspect", ["inspect"]],
          ["export", ["export"]],
          ["run", ["run", "--", "node", "-e", ""]],
          ["cache path", ["cache", "path"]],
          ["cache list", ["cache", "list"]],
          ["cache clear", ["cache", "clear"]],
        ];

        for (const [name, args] of commands) {
          const result = yield* runCli(runtime, app, [...cached, ...args], sandbox.env);

          expect(result.stderr).toMatch(/step=startup durationMs=\d+ outcome=success/);
          expect(result.stderr).toMatch(
            new RegExp(`step=command durationMs=\\d+ outcome=success command="?${name}"?`),
          );
        }

        const first = yield* runCli(
          runtime,
          app,
          [...cached, "--refresh", "run", "--", "node", "-e", ""],
          sandbox.env,
        );

        for (const step of [
          "config.import",
          "cache.read",
          "resolve.lock",
          "provider.resolve",
          "cache.write",
          "custom.resolve",
          "run.child",
        ]) {
          expect(first.stderr).toMatch(new RegExp(`step=${step} durationMs=\\d+ outcome=success`));
        }

        expect(first.stderr).not.toContain("dev-token-value");
      }),
    );

    it.effect("logs the duration of a step that fails", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");

        const result = yield* runCli(runtime, app, ["--no-cache", "--debug", "check"], {
          ...sandbox.env,
          ENVI_E2E_SECRETS_FILE: `${sandbox.directory}/missing.json`,
        });

        expect(result.stderr).toMatch(/step=provider\.resolve durationMs=\d+ outcome=failure/);
      }),
    );

    it.effect("prints no debug log without --debug", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const result = yield* runCli(runtime, app, ["--no-cache", "check"], sandbox.env);

        expect(result.stderr).toBe("");
      }),
    );

    it.effect("prints the help text with every command", () =>
      Effect.gen(function* () {
        const result = yield* runCli(runtime, app, ["--help"]);

        expect(result.exitCode).toBe(0);

        for (const name of ["run", "sync", "inspect", "check", "export", "cache"]) {
          expect(result.stdout).toContain(name);
        }
      }),
    );

    it.effect("rejects an unknown command and an unknown flag", () =>
      Effect.gen(function* () {
        const command = yield* runCli(runtime, app, ["deploy"]);
        const flag = yield* runCli(runtime, app, ["check", "--no-such-flag"]);

        expect(command.exitCode).not.toBe(0);
        expect(flag.exitCode).not.toBe(0);
      }),
    );
  });
});
