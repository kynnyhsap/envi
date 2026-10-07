// `envi doctor`: the facts of a setup that a public issue can hold. It imports no config, reads
// no secret, and prints no path and no value of a variable.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import { DoctorReport } from "@kynnyhsap/envi";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { decodeJson, enviVersion, gitInit, runCli, runProcess, runtimes } from "./helpers.ts";

/** Each `ENVI_*` variable of the test process, removed, so a report names only those of a test. */
const withoutInherited = Object.fromEntries(
  Object.keys(process.env)
    .filter((name) => name.startsWith("ENVI_"))
    .map((name) => [name, undefined]),
);

/** The keychain command of each platform. */
const commands = new Map([
  ["darwin", "security"],
  ["linux", "secret-tool"],
]);

/** A config that leaves a marker file when a process imports it. */
const markingConfig = `import { writeFileSync } from "node:fs";
writeFileSync(process.env.DOCTOR_E2E_IMPORT_MARKER, "imported");
export default {};
`;

const fakeKey = "fake-cache-key-sentinel";

const fakeStage = "fake-stage-sentinel";

const malformedSetting = "malformed-setting-sentinel";

/** A git fsmonitor hook that leaves a marker file when git runs it. */
const markingHook = (marker: string) => `#!/bin/sh
echo ran > "${marker}"
`;

/** The keychain of each platform. Another platform has none. */
const stores = new Map([
  ["darwin", "macos"],
  ["linux", "secret-service"],
]);

/** A git project with a config at its root and one in a package. */
const makeProject = Effect.fn("makeProject")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "envi-doctor-" });
  const project = path.join(root, "project");
  const api = path.join(project, "packages", "api");

  yield* fs.makeDirectory(api, { recursive: true });
  yield* fs.writeFileString(path.join(project, "envi.config.ts"), markingConfig);
  yield* fs.writeFileString(path.join(api, "envi.config.ts"), markingConfig);
  yield* gitInit(project);

  // Git runs the fsmonitor hook of the repo before it lists the files.
  const hook = path.join(root, "fsmonitor");
  const hookMarker = path.join(root, "hook-ran");

  yield* fs.writeFileString(hook, markingHook(hookMarker));
  yield* fs.chmod(hook, 0o755);
  yield* runProcess("git", ["config", "core.fsmonitor", hook], project);

  return { root, project, api, marker: path.join(root, "imported"), hookMarker };
});

layer(NodeServices.layer, { excludeTestServices: true })("envi doctor", (it) => {
  describe.each(runtimes)("on %s", (runtime) => {
    it.effect(
      "reports the setup without user code, a path, or a value, also with a bad setting",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const project = yield* makeProject();

          const env = {
            ...withoutInherited,
            CI: "true",
            ENVI_CONFIG_SEARCH: undefined,
            ENVI_CACHE_DIR: project.root,
            ENVI_CACHE_ENABLED: malformedSetting,
            ENVI_CACHE_KEY: fakeKey,
            ENVI_STAGE: fakeStage,
            DOCTOR_E2E_IMPORT_MARKER: project.marker,
          };

          const json = yield* runCli(runtime, project.api, ["doctor", "--json"], env);
          const text = yield* runCli(runtime, project.api, ["doctor"], env);
          const report = yield* decodeJson(DoctorReport, json.stdout);

          expect(json.exitCode).toBe(0);
          expect(text.exitCode).toBe(0);
          expect(report.version).toBe(enviVersion);
          expect(report.runtime.name).toBe(runtime);
          expect(report.platform).toBe(process.platform);
          expect(report.arch).toBe(process.arch);
          expect(report.ci).toBe(true);
          expect(report.configs).toEqual({ up: 1, repo: 2 });
          expect(report.cacheDirectory).toBe(true);
          expect(report.keychain.store).toBe(stores.get(process.platform) ?? "none");
          expect(report.variables).toEqual([
            "ENVI_CACHE_DIR",
            "ENVI_CACHE_ENABLED",
            "ENVI_CACHE_KEY",
            "ENVI_STAGE",
          ]);

          expect(yield* fs.exists(project.marker)).toBe(false);
          expect(yield* fs.exists(project.hookMarker)).toBe(false);

          for (const output of [json, text]) {
            for (const hidden of [project.root, fakeKey, fakeStage, malformedSetting]) {
              expect(output.stdout + output.stderr).not.toContain(hidden);
            }
          }
        }),
    );

    it.effect("finds the keychain command in the working folder through an empty PATH entry", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "envi-doctor-" });
        const bin = path.join(root, "bin");
        const work = path.join(root, "work");
        const command = path.join(work, commands.get(process.platform) ?? "");
        const located = yield* runProcess(runtime, ["-e", "console.log(process.execPath)"], root);

        yield* fs.makeDirectory(bin);
        yield* fs.makeDirectory(work);
        yield* fs.symlink(located.stdout.trim(), path.join(bin, runtime));

        // The empty entry at the end of `PATH` names the working folder.
        const found = Effect.flatMap(
          runCli(runtime, work, ["doctor", "--json"], { PATH: `${bin}:` }),
          (result) => decodeJson(DoctorReport, result.stdout),
        );

        expect((yield* found).keychain.command).toBe(false);

        yield* fs.writeFileString(command, "");
        yield* fs.chmod(command, 0o755);

        expect((yield* found).keychain.command).toBe(true);
      }),
    );

    it.effect("reports no config and no cache directory in an empty folder without HOME", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const empty = yield* fs.makeTempDirectoryScoped({ prefix: "envi-doctor-" });

        const result = yield* runCli(runtime, empty, ["doctor", "--json"], {
          ...withoutInherited,
          HOME: undefined,
          ENVI_CONFIG_SEARCH: undefined,
        });

        const report = yield* decodeJson(DoctorReport, result.stdout);

        expect(result.exitCode).toBe(0);
        expect(report.configs).toEqual({ up: 0, repo: 0 });
        expect(report.cacheDirectory).toBe(false);
        expect(report.variables).toEqual([]);
      }),
    );
  });
});
