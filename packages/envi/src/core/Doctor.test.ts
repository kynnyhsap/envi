// The keychain command of `envi doctor`: only an executable file on `PATH` counts, because a
// directory or a file without the execute bit cannot run.
import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ConfigLoader from "./ConfigLoader.ts";
import * as Doctor from "./Doctor.ts";
import { ParentEnvironment } from "./Envi.ts";
import { nodePlatform, withEnv } from "./fixtures/Support.ts";
import * as Keychain from "./Keychain.ts";

const platform = Layer.provideMerge(
  ConfigLoader.layer,
  Layer.provideMerge(NodeChildProcessSpawner.layer, nodePlatform),
);

const system = Layer.succeed(Doctor.System, {
  runtime: "node",
  runtimeVersion: "0.0.0",
  platform: "darwin",
  arch: "arm64",
  keychain: Keychain.Store.MacOs,
});

/** The `keychain.command` of a report whose `PATH` holds the folders. */
const commandFound = (folders: ReadonlyArray<string>) =>
  Effect.map(
    Doctor.report().pipe(
      Effect.provide(system),
      Effect.provideService(ParentEnvironment, { PATH: folders.join(":") }),
      withEnv({}),
    ),
    (report) => report.keychain.command,
  );

describe("Doctor", () => {
  it.effect("finds the keychain command only as an executable file on PATH", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "envi-doctor-" });
      const command = "security";
      const folders = ["directory", "plain", "executable"].map((name) => path.join(root, name));
      const [directory = "", plain = "", executable = ""] = folders;

      for (const folder of folders) {
        yield* fs.makeDirectory(folder);
      }

      yield* fs.makeDirectory(path.join(directory, command));
      yield* fs.writeFileString(path.join(plain, command), "");
      yield* fs.chmod(path.join(plain, command), 0o644);

      expect(yield* commandFound([directory, plain])).toBe(false);

      yield* fs.writeFileString(path.join(executable, command), "");
      yield* fs.chmod(path.join(executable, command), 0o755);

      expect(yield* commandFound([directory, plain, executable])).toBe(true);
    }).pipe(Effect.provide(platform)),
  );
});
