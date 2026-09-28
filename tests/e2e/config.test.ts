// Config loading, the global flags, the install hint, and the delegation to a local `envi`.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import { CheckReport, ErrorReport, SyncReport } from "@kynnyhsap/envi";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { fileURLToPath } from "node:url";

import {
  decodeJson,
  docsOf,
  enviVersion,
  ExportedVars,
  fixture,
  gitInit,
  makeSandbox,
  runCli,
  runProcess,
  runtimes,
} from "./helpers.ts";

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
          ["check", "--no-cache", "--json"],
          sandbox.env,
        );

        expect(result.exitCode).toBe(0);
        expect((yield* decodeJson(CheckReport, result.stdout)).passed).toContain("API_TOKEN");
      }),
    );

    it.effect("searches the repo for sync, up for check, and down with the flag", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sandbox = yield* makeSandbox("none");
        const root = path.join(sandbox.directory, "repo");
        const entry = path.join(enviPackage, "dist/index.js");

        const writeConfig = (folder: string, text: string) =>
          Effect.andThen(
            fs.makeDirectory(path.join(root, folder), { recursive: true }),
            fs.writeFileString(path.join(root, folder, "envi.config.ts"), text),
          );

        const config = (name: string) =>
          `import { defineConfig } from ${JSON.stringify(entry)};\n\nexport default defineConfig({ cache: false, vars: { ${name}: "1" } });\n`;

        yield* writeConfig("apps/api", config("API"));
        yield* writeConfig("apps/web", config("WEB"));
        yield* writeConfig("ignored", 'throw new Error("git ignores this config");\n');
        yield* fs.writeFileString(path.join(root, ".gitignore"), "ignored/\n");
        yield* gitInit(root);

        const env = { ...sandbox.env, ENVI_CONFIG_SEARCH: undefined };
        const api = path.join(root, "apps/api");
        const synced = yield* runCli(runtime, api, ["sync", "--json"], env);
        const checked = yield* runCli(runtime, api, ["check", "--json"], env);

        const byFlag = yield* runCli(
          runtime,
          path.join(root, "apps"),
          ["check", "--config-search", "down"],
          env,
        );

        const byVariable = yield* runCli(runtime, path.join(root, "apps"), ["check"], {
          ...env,
          ENVI_CONFIG_SEARCH: "down",
        });

        expect(yield* decodeJson(SyncReport, synced.stdout)).toMatchObject({
          configs: 2,
          failures: [],
        });
        expect((yield* decodeJson(CheckReport, checked.stdout)).passed).toEqual(["API"]);
        expect(byFlag.exitCode).toBe(1);
        expect(byFlag.stderr).toContain("ManyConfigs");
        expect(byVariable.stderr).toContain("ManyConfigs");
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
          ["sync", "--no-cache", "--config", api, "--config", web, "--json"],
          sandbox.env,
        );

        const byVariable = yield* runCli(
          runtime,
          sandbox.directory,
          ["sync", "--no-cache", "--json"],
          { ...sandbox.env, ENVI_CONFIG: `${api}, ${web}` },
        );

        expect((yield* decodeJson(SyncReport, byFlag.stdout)).configs).toBe(2);
        expect((yield* decodeJson(SyncReport, byVariable.stdout)).configs).toBe(2);
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
          ["check", "--config", api, "--config", web],
          sandbox.env,
        );

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("ManyConfigs");
        expect(result.stderr).toContain("This command uses one config, and Envi found 2.");
      }),
    );

    it.effect("reports a config file with a wrong extension and a file that does not exist", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const sandbox = yield* makeSandbox("none");

        const extension = yield* runCli(runtime, app, [
          "check",
          "--config",
          path.join(workspace, "package.json"),
        ]);

        const missing = yield* runCli(runtime, app, [
          "check",
          "--config",
          path.join(sandbox.directory, "nope.config.ts"),
        ]);

        expect(extension.exitCode).toBe(1);
        expect(extension.stderr).toContain(`docs: ${docsOf("config-load-invalid-config")}`);
        expect(missing.exitCode).toBe(1);
        expect(missing.stderr).toContain(`docs: ${docsOf("config-load-not-found")}`);
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
        expect(text.stderr).toContain(`docs: ${docsOf("config-load-config-syntax")}`);
        expect(text.stderr + json.stdout).not.toContain("secret-in-source");
        expect(json.exitCode).toBe(1);
        expect((yield* decodeJson(ErrorReport, json.stdout)).error).toMatchObject({
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
          'import { defineConfig } from "@kynnyhsap/envi";\n\nexport default defineConfig({ vars: { A: "1" } });\n',
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

        const runGlobal = (cwd: string, env: Readonly<Record<string, string>>) =>
          Effect.map(
            runProcess(runtime, [path.join(globalCopy, "dist/bin.js"), "--version"], cwd, env),
            (result) => result.stdout,
          );

        const delegated = yield* runGlobal(app, {});
        const marked = yield* runGlobal(app, { ENVI_DELEGATED: "1" });
        const outside = yield* runGlobal("/", {});

        // In the project, the global Envi starts the local Envi. The marker stops a loop.
        expect(delegated).toContain(enviVersion);
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
            "run",
            "--no-cache",
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
          "export",
          "--cache-dir",
          sandbox.cacheDirectory,
          "--debug",
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

        // The logs leave stdout clean, so stdout decodes as the export.
        expect(yield* decodeJson(ExportedVars, pretty.stdout)).toHaveProperty("API_TOKEN");
        expect(pretty.stderr).toContain("level=DEBUG");
        expect(JSON.parse(firstLog ?? "")).toMatchObject({ level: "DEBUG" });
        expect(pretty.stderr + json.stderr).not.toContain("dev-token-value");
      }),
    );

    it.effect("logs the duration of every command and of every step with --debug", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const cached = ["--cache-dir", sandbox.cacheDirectory, "--debug"];

        // The name of each command, and the arguments after its flags.
        const commands: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
          ["sync", []],
          ["check", []],
          ["inspect", []],
          ["export", []],
          ["run", ["--", "node", "-e", ""]],
          ["cache path", []],
          ["cache list", []],
          ["cache clear", []],
        ];

        for (const [name, rest] of commands) {
          const result = yield* runCli(
            runtime,
            app,
            [...name.split(" "), ...cached, ...rest],
            sandbox.env,
          );

          expect(result.stderr).toMatch(/step=startup durationMs=\d+ outcome=success/);
          expect(result.stderr).toMatch(
            new RegExp(`step=command durationMs=\\d+ outcome=success command="?${name}"?`),
          );
        }

        const first = yield* runCli(
          runtime,
          app,
          ["run", ...cached, "--refresh", "--", "node", "-e", ""],
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

        const result = yield* runCli(runtime, app, ["check", "--no-cache", "--debug"], {
          ...sandbox.env,
          ENVI_E2E_SECRETS_FILE: `${sandbox.directory}/missing.json`,
        });

        expect(result.stderr).toMatch(/step=provider\.resolve durationMs=\d+ outcome=failure/);
      }),
    );

    it.effect("prints no debug log without --debug", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const result = yield* runCli(runtime, app, ["check", "--no-cache"], sandbox.env);

        expect(result.stderr).toBe("");
      }),
    );

    it.effect("rejects an unknown command, an unknown flag, and a flag before its command", () =>
      Effect.gen(function* () {
        const command = yield* runCli(runtime, app, ["deploy"]);
        const flag = yield* runCli(runtime, app, ["check", "--no-such-flag"]);
        const early = yield* runCli(runtime, app, ["--stage", "production", "check"]);

        expect([command.exitCode, flag.exitCode, early.exitCode]).toEqual([1, 1, 1]);
        expect(command.stderr).toContain('Unknown subcommand "deploy"');
        expect(flag.stderr).toContain("Unrecognized flag: --no-such-flag");
        expect(early.stderr).toContain("Unrecognized flag: --stage in command envi");
      }),
    );
  });
});
