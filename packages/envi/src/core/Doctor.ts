// `envi doctor`: the facts of a setup for a bug report. It imports no config, reads no secret,
// and runs no provider and no keychain command, so it never shows a prompt.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as CacheSettings from "./CacheSettings.ts";
import * as ConfigLoader from "./ConfigLoader.ts";
import { ParentEnvironment } from "./Envi.ts";
import { ConfigLoadFailure } from "./Errors.ts";
import * as Keychain from "./Keychain.ts";
import * as Package from "./Package.ts";
import type { DoctorReport, RuntimeName } from "./Reports.ts";
import * as Settings from "./Settings.ts";

/** The facts of the process that only the entry point reads. */
export interface Interface {
  readonly runtime: RuntimeName;
  readonly runtimeVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly keychain: Keychain.Store;
}

export class System extends Context.Service<System, Interface>()("envi/Doctor/System") {}

/** The prefix of the variables of Envi. */
const variablePrefix = "ENVI_";

/** The variable of the folders that hold commands, and the separator of the folders. */
const pathVariable = "PATH";

const pathSeparator = ":";

/** The number of config files of one search. A search that finds no file counts 0. */
const countConfigs = (directory: string, search: ConfigLoader.ConfigSearch) =>
  Effect.flatMap(ConfigLoader.ConfigLoader, (loader) =>
    loader.find(directory, search).pipe(
      Effect.map((files) => files.length),
      Effect.catchIf(
        (error) => error.reason === ConfigLoadFailure.NoConfig,
        () => Effect.succeed(0),
      ),
    ),
  );

/** `true` when a folder of `PATH` holds the command. Envi does not run it. */
const onPath = Effect.fn("Doctor.onPath")(function* (command: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* ParentEnvironment;
  const folders = (environment[pathVariable] ?? "").split(pathSeparator);

  const found = yield* Effect.findFirst(
    folders.filter((folder) => folder !== ""),
    (folder) => Effect.orElseSucceed(fs.exists(path.join(folder, command)), () => false),
  );

  return Option.isSome(found);
});

/** The report of `envi doctor` for the working directory. */
export const report = Effect.fn("Doctor.report")(function* () {
  const system = yield* System;
  const path = yield* Path.Path;
  const environment = yield* ParentEnvironment;
  const here = path.resolve(".");
  const cache = yield* CacheSettings.select(CacheSettings.noOverrides, Option.none());
  const command = Keychain.commandOf(system.keychain);

  const doctor: DoctorReport = {
    version: Package.version,
    runtime: { name: system.runtime, version: system.runtimeVersion },
    platform: system.platform,
    arch: system.arch,
    ci: yield* Settings.isCi,
    configs: {
      up: yield* countConfigs(here, ConfigLoader.ConfigSearch.Up),
      repo: yield* countConfigs(here, ConfigLoader.ConfigSearch.Repo),
    },
    cacheDirectory: Option.isSome(cache.directory),
    keychain: {
      store: system.keychain,
      command: Option.isSome(command) ? yield* onPath(command.value) : null,
    },
    variables: Object.keys(environment)
      .filter((name) => name.startsWith(variablePrefix) && environment[name] !== undefined)
      .toSorted(),
  };

  return doctor;
});
