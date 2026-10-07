// `envi doctor`: the facts of a setup that a public issue can hold. It imports no config, reads
// no secret, and prints no path and no value of a variable.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import { DoctorReport } from "@kynnyhsap/envi";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { decodeJson, enviVersion, gitInit, runCli, runtimes } from "./helpers.ts";

/** A config that leaves a marker file when a process imports it. */
const markingConfig = `import { writeFileSync } from "node:fs";
writeFileSync(process.env.DOCTOR_E2E_IMPORT_MARKER, "imported");
export default {};
`;

const fakeKey = "fake-cache-key-sentinel";

const fakeStage = "fake-stage-sentinel";

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

  return { root, project, api, marker: path.join(root, "imported") };
});

layer(NodeServices.layer, { excludeTestServices: true })("envi doctor", (it) => {
  describe.each(runtimes)("on %s", (runtime) => {
    it.effect("reports the setup without importing a config or printing a path or a value", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const project = yield* makeProject();

        const env = {
          CI: "true",
          ENVI_CONFIG_SEARCH: undefined,
          ENVI_CACHE_DIR: project.root,
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
        expect(report.variables).toEqual(["ENVI_CACHE_DIR", "ENVI_CACHE_KEY", "ENVI_STAGE"]);
        expect(yield* fs.exists(project.marker)).toBe(false);

        for (const output of [json, text]) {
          for (const hidden of [project.root, fakeKey, fakeStage]) {
            expect(output.stdout + output.stderr).not.toContain(hidden);
          }
        }
      }),
    );

    it.effect("reports no config and no cache directory in an empty folder without HOME", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const empty = yield* fs.makeTempDirectoryScoped({ prefix: "envi-doctor-" });

        const result = yield* runCli(runtime, empty, ["doctor", "--json"], {
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
