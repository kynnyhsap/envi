import * as Arr from "effect/Array";
import * as EffectConfig from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";

import * as Config from "./Config.ts";
import { ConfigLoadError, ConfigLoadFailure } from "./Errors.ts";
import * as Thrown from "./Thrown.ts";
import * as Timing from "./Timing.ts";

/** The base name of a config file that Envi finds on its own. */
export const configBaseName = "envi.config";

/** The extensions of a config file, in the order of the search. */
export const configExtensions: ReadonlyArray<string> = [".ts", ".mts", ".js", ".mjs"];

/** The lowest Node version that imports a TypeScript file without a flag. */
export const minimumNodeVersion = "22.19.0";

/**
 * The directions of the config search. The project root is the nearest folder with `.git`.
 */
export const ConfigSearch = {
  /** The nearest config in the folder or an ancestor, up to the project root or the home folder. */
  Up: "up",
  /** Every config in the folder and below it. Git decides which files count in a repo. */
  Down: "down",
  /** Every config of the project: a search down from the project root. */
  Repo: "repo",
} as const;

/** The schema of `ConfigSearch`. */
export const ConfigSearchSchema = Schema.Literals([
  ConfigSearch.Up,
  ConfigSearch.Down,
  ConfigSearch.Repo,
]);

export type ConfigSearch = typeof ConfigSearchSchema.Type;

/** The variable of the config search direction. */
export const configSearchVariable = "ENVI_CONFIG_SEARCH";

/** Finds and loads config files. */
export interface Interface {
  /** Imports one config file. The default export must come from `defineConfig`. */
  readonly load: (file: string) => Effect.Effect<Config.Config, ConfigLoadError>;
  /**
   * The config files of a search from a directory, sorted by path. `up` finds one file. A search
   * that finds no file fails with `NoConfig`.
   */
  readonly find: (
    directory: string,
    search: ConfigSearch,
  ) => Effect.Effect<Arr.NonEmptyReadonlyArray<string>, ConfigLoadError>;
}

/** The config loader service. */
export class ConfigLoader extends Context.Service<ConfigLoader, Interface>()("envi/ConfigLoader") {}

const gitMarker = ".git";

const homeVariable = "HOME";

/** A search down never enters these folders, and no folder whose name starts with a dot. */
const skippedFolder = "node_modules";

const unknownExtensionCode = "ERR_UNKNOWN_FILE_EXTENSION";

const moduleNotFoundCode = "ERR_MODULE_NOT_FOUND";

/** A parse error of Bun. The message and the line text are left out: they show source code. */
const BuildMessage = Schema.Struct({
  name: Schema.Literal("BuildMessage"),
  position: Schema.Struct({ file: Schema.String, line: Schema.Number, column: Schema.Number }),
});

/** Bun throws one build message, or an aggregate of them for several errors. */
const BuildFailure = Schema.Union([
  BuildMessage,
  Schema.Struct({ errors: Schema.NonEmptyArray(BuildMessage) }),
]);

const isBuildMessage = Schema.is(BuildMessage);

const asBuildFailure = Schema.decodeUnknownOption(BuildFailure);

/** A parse error of Node. The first line of its stack is the location in the file. */
const asSyntaxError = Schema.decodeUnknownOption(Schema.instanceOf(SyntaxError));

/**
 * The location of a syntax error in a config file. The outer `Option` is none for another failure.
 * The inner value is undefined when the runtime does not report the location.
 */
const syntaxLocationOf = (cause: unknown): Option.Option<string | undefined> =>
  Option.orElse(
    Option.map(asBuildFailure(cause), (failure) => {
      const { position } = isBuildMessage(failure) ? failure : failure.errors[0];

      return `${position.file}:${position.line}:${position.column}`;
    }),
    () => Option.map(asSyntaxError(cause), (error) => Thrown.locationOf(error.stack ?? "")),
  );

const noConfig = (directory: string, detail: string) =>
  new ConfigLoadError({ reason: ConfigLoadFailure.NoConfig, path: directory, detail });

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner;

  const exists = (file: string) => Effect.orElseSucceed(fs.exists(file), () => false);

  const configIn = (directory: string): Effect.Effect<Option.Option<string>> =>
    Effect.findFirst(
      configExtensions.map((extension) => path.join(directory, `${configBaseName}${extension}`)),
      exists,
    );

  const importFailure = (file: string, cause: unknown): ConfigLoadError => {
    const code = Predicate.hasProperty(cause, "code") ? cause.code : undefined;

    if (code === unknownExtensionCode) {
      return new ConfigLoadError({
        reason: ConfigLoadFailure.UnsupportedRuntime,
        path: file,
        detail: `A TypeScript config needs Node ${minimumNodeVersion} or later, or Bun.`,
      });
    }

    if (code === moduleNotFoundCode) {
      return new ConfigLoadError({
        reason: ConfigLoadFailure.MissingDependency,
        path: file,
        detail:
          "The config imports a module that does not resolve. Install Envi and each provider package in the project, such as `bun add -d envi`.",
      });
    }

    const syntax = syntaxLocationOf(cause);

    if (Option.isSome(syntax)) {
      return new ConfigLoadError({
        reason: ConfigLoadFailure.ConfigSyntax,
        path: file,
        detail: "The file has a syntax error.",
        location: syntax.value,
      });
    }

    // The cause can hold a secret from user code, so the error holds only its name and location.
    const { thrown, location } = Thrown.describe(Thrown.asError(cause));

    return new ConfigLoadError({
      reason: ConfigLoadFailure.ImportFailed,
      path: file,
      detail: `The import threw ${thrown}.`,
      location,
    });
  };

  const load: Interface["load"] = Effect.fn("ConfigLoader.load")(function* (file) {
    const absolute = path.resolve(file);

    if (!(yield* exists(absolute))) {
      return yield* new ConfigLoadError({
        reason: ConfigLoadFailure.NotFound,
        path: absolute,
        detail: "The file does not exist.",
      });
    }

    const invalid = (detail: string) =>
      new ConfigLoadError({ reason: ConfigLoadFailure.InvalidConfig, path: absolute, detail });

    if (!configExtensions.includes(path.extname(absolute))) {
      return yield* invalid(`A config file ends with ${configExtensions.join(", ")}.`);
    }

    const url = yield* Effect.mapError(path.toFileUrl(absolute), () =>
      invalid("The path does not convert to a file URL."),
    );

    // The query gives each modified file a new module identity. It does not reload its imports.
    const modified = yield* fs.stat(absolute).pipe(
      Effect.map((info) =>
        Option.getOrElse(
          Option.map(info.mtime, (time) => time.getTime()),
          () => 0,
        ),
      ),
      Effect.orElseSucceed(() => 0),
    );

    url.searchParams.set("cache", String(modified));

    const module: unknown = yield* Effect.tryPromise({
      try: () => import(url.href),
      catch: (cause) => importFailure(absolute, cause),
    }).pipe(Timing.measure("config.import", { file: absolute }));

    const exported = Predicate.hasProperty(module, "default") ? module.default : undefined;

    return Config.isConfig(exported)
      ? { ...exported, path: Option.some(absolute) }
      : yield* invalid("The default export must be the result of `defineConfig`.");
  });

  const configNames = new Set(configExtensions.map((extension) => `${configBaseName}${extension}`));

  /** The nearest folder with `.git`, a folder in a repo or a file in a worktree. */
  const projectRoot = Effect.fn("ConfigLoader.projectRoot")(function* (start: string) {
    let current = start;

    while (true) {
      if (yield* exists(path.join(current, gitMarker))) {
        return Option.some(current);
      }

      const parent = path.dirname(current);

      if (parent === current) {
        return Option.none<string>();
      }

      current = parent;
    }
  });

  const isWithin = (file: string, folder: string) => {
    const relative = path.relative(folder, file);

    return !relative.startsWith("..") && !path.isAbsolute(relative);
  };

  const up = Effect.fn("ConfigLoader.up")(function* (start: string) {
    const home = yield* Effect.orElseSucceed(
      EffectConfig.option(EffectConfig.String(homeVariable)),
      () => Option.none<string>(),
    );

    const stop = Option.orElse(yield* projectRoot(start), () =>
      Option.filter(home, (folder) => isWithin(start, path.resolve(folder))).pipe(
        Option.map((folder) => path.resolve(folder)),
      ),
    );

    let current = start;

    while (true) {
      const found = yield* configIn(current);

      if (Option.isSome(found)) {
        return Arr.of(found.value);
      }

      const parent = path.dirname(current);

      if (Option.contains(stop, current) || parent === current) {
        return yield* noConfig(
          start,
          `No ${configBaseName}.ts exists in this directory or in an ancestor up to ${Option.getOrElse(stop, () => parent)}.`,
        );
      }

      current = parent;
    }
  });

  /** The files that git tracks or does not ignore. None when git fails, as outside a repo. */
  const gitFiles = (directory: string): Effect.Effect<Option.Option<ReadonlyArray<string>>> =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(
          ChildProcess.make(
            "git",
            ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            {
              cwd: directory,
              stdin: "ignore",
              stderr: "ignore",
            },
          ),
        );

        const [stdout, exitCode] = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
          { concurrency: 2 },
        );

        return exitCode === 0
          ? Option.some(
              stdout
                .split("\0")
                .filter((file) => file !== "")
                .map((file) => path.join(directory, file)),
            )
          : Option.none();
      }),
    ).pipe(Effect.orElseSucceed(() => Option.none()));

  /** Every config file below a folder, without `node_modules` and dot folders. */
  const walk = (directory: string): Effect.Effect<ReadonlyArray<string>> =>
    Effect.gen(function* () {
      const names = yield* Effect.orElseSucceed(fs.readDirectory(directory), () => []);

      const nested = yield* Effect.forEach(names, (name) => {
        const file = path.join(directory, name);

        if (configNames.has(name)) {
          return Effect.succeed([file]);
        }

        if (name === skippedFolder || name.startsWith(".")) {
          return Effect.succeed([]);
        }

        return fs.stat(file).pipe(
          Effect.flatMap((info) => (info.type === "Directory" ? walk(file) : Effect.succeed([]))),
          Effect.orElseSucceed(() => []),
        );
      });

      return nested.flat();
    });

  const down = Effect.fn("ConfigLoader.down")(function* (start: string) {
    const listed = Option.isSome(yield* projectRoot(start))
      ? yield* gitFiles(start)
      : Option.none<ReadonlyArray<string>>();

    const candidates = Option.isSome(listed)
      ? yield* Effect.filter(
          listed.value.filter((file) => configNames.has(path.basename(file))),
          exists,
        )
      : yield* walk(start);

    const skipped = (file: string) =>
      path
        .relative(start, path.dirname(file))
        .split(path.sep)
        .some((part) => part === skippedFolder || part.startsWith("."));

    // One config per folder: the first extension in the order of the search.
    const byFolder = Arr.groupBy(
      candidates.filter((file) => !skipped(file)),
      (file) => path.dirname(file),
    );

    const found = Object.values(byFolder)
      .map((files) =>
        files.toSorted(
          (a, b) =>
            configExtensions.indexOf(path.extname(a)) - configExtensions.indexOf(path.extname(b)),
        ),
      )
      .flatMap((files) => files.slice(0, 1))
      .toSorted();

    return Arr.isReadonlyArrayNonEmpty(found)
      ? found
      : yield* noConfig(start, `No ${configBaseName}.ts exists in this directory or below it.`);
  });

  const find: Interface["find"] = (directory, search) => {
    const start = path.resolve(directory);

    if (search === ConfigSearch.Up) {
      return up(start);
    }

    return search === ConfigSearch.Down
      ? down(start)
      : Effect.flatMap(projectRoot(start), (root) => down(Option.getOrElse(root, () => start)));
  };

  return ConfigLoader.of({ load, find });
});

/** The config loader on top of the platform file system. */
export const layer: Layer.Layer<
  ConfigLoader,
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner
> = Layer.effect(ConfigLoader, make);
