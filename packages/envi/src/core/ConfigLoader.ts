import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as ChildProcess from "effect/process/ChildProcess";
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as Config from "./Config.ts";
import { ConfigLoadError, ConfigLoadFailure } from "./Errors.ts";
import * as Package from "./Package.ts";
import * as Settings from "./Settings.ts";
import * as Thrown from "./Thrown.ts";
import * as Timing from "./Timing.ts";

/** The base name of a config file that Envi finds on its own. */
const configBaseName = "envi.config";

/** The extensions of a config file, in the order of the search. */
const configExtensions: ReadonlyArray<string> = [".ts", ".mts", ".js", ".mjs"];

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
export const ConfigSearchSchema = Schema.Enum(ConfigSearch);

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

/** The platform services of the config search and the import. */
interface Host {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly spawner: ChildProcessSpawner["Service"];
}

const exists = (host: Host, file: string) =>
  Effect.orElseSucceed(host.fs.exists(file), () => false);

const configIn = (host: Host, directory: string): Effect.Effect<Option.Option<string>> =>
  Effect.findFirst(
    configExtensions.map((extension) => host.path.join(directory, `${configBaseName}${extension}`)),
    (file) => exists(host, file),
  );

const importFailure = (file: string, cause: unknown): ConfigLoadError => {
  const code = Predicate.hasProperty(cause, "code") ? cause.code : undefined;

  if (code === unknownExtensionCode) {
    return new ConfigLoadError({
      reason: ConfigLoadFailure.UnsupportedRuntime,
      path: file,
      detail: `A TypeScript config needs Node ${Package.minimumNodeVersion} or later, or Bun ${Package.minimumBunVersion} or later.`,
    });
  }

  if (code === moduleNotFoundCode) {
    return new ConfigLoadError({
      reason: ConfigLoadFailure.MissingDependency,
      path: file,
      detail: `The config imports a module that does not resolve. Install Envi and each provider package in the project, such as \`bun add -d ${Package.name}\`.`,
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

const load = Effect.fn("ConfigLoader.load")(function* (host: Host, file: string) {
  const absolute = host.path.resolve(file);

  if (!(yield* exists(host, absolute))) {
    return yield* new ConfigLoadError({
      reason: ConfigLoadFailure.NotFound,
      path: absolute,
      detail: "The file does not exist.",
    });
  }

  const invalid = (detail: string) =>
    new ConfigLoadError({ reason: ConfigLoadFailure.InvalidConfig, path: absolute, detail });

  if (!configExtensions.includes(host.path.extname(absolute))) {
    return yield* invalid(`A config file ends with ${configExtensions.join(", ")}.`);
  }

  const url = yield* Effect.mapError(host.path.toFileUrl(absolute), () =>
    invalid("The path does not convert to a file URL."),
  );

  // The query gives each modified file a new module identity. It does not reload its imports.
  const modified = yield* host.fs.stat(absolute).pipe(
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
  }).pipe(Timing.measure(Timing.Step.ConfigImport, { file: absolute }));

  const exported = Predicate.hasProperty(module, "default") ? module.default : undefined;

  return Config.isConfig(exported)
    ? { ...exported, path: Option.some(absolute) }
    : yield* invalid("The default export must be the result of `defineConfig`.");
});

const configNames = new Set(configExtensions.map((extension) => `${configBaseName}${extension}`));

/** The nearest folder with `.git`, a folder in a repo or a file in a worktree. */
const projectRoot = Effect.fn("ConfigLoader.projectRoot")(function* (host: Host, start: string) {
  let current = start;

  while (true) {
    if (yield* exists(host, host.path.join(current, gitMarker))) {
      return Option.some(current);
    }

    const parent = host.path.dirname(current);

    if (parent === current) {
      return Option.none<string>();
    }

    current = parent;
  }
});

const isWithin = (host: Host, file: string, folder: string) => {
  const relative = host.path.relative(folder, file);

  return !relative.startsWith("..") && !host.path.isAbsolute(relative);
};

const up = Effect.fn("ConfigLoader.up")(function* (host: Host, start: string) {
  const home = yield* Settings.home;

  const stop = Option.orElse(yield* projectRoot(host, start), () =>
    Option.filter(home, (folder) => isWithin(host, start, host.path.resolve(folder))).pipe(
      Option.map((folder) => host.path.resolve(folder)),
    ),
  );

  let current = start;

  while (true) {
    const found = yield* configIn(host, current);

    if (Option.isSome(found)) {
      return Arr.of(found.value);
    }

    const parent = host.path.dirname(current);

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
const gitFiles = (
  host: Host,
  directory: string,
): Effect.Effect<Option.Option<ReadonlyArray<string>>> =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* host.spawner.spawn(
        ChildProcess.make("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
          cwd: directory,
          stdin: "ignore",
          stderr: "ignore",
        }),
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
              .map((file) => host.path.join(directory, file)),
          )
        : Option.none();
    }),
  ).pipe(Effect.orElseSucceed(() => Option.none()));

/**
 * Every config file below a folder, without `node_modules` and dot folders. The walk follows a
 * symlink to a folder, and it enters each real folder once, by the first path that reaches it.
 * `visited` holds the real paths of the folders that the walk entered.
 */
const walkFrom = (
  host: Host,
  visited: Set<string>,
  directory: string,
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    const real = yield* Effect.orElseSucceed(host.fs.realPath(directory), () => directory);

    if (visited.has(real)) {
      return [];
    }

    visited.add(real);

    const names = yield* Effect.orElseSucceed(host.fs.readDirectory(directory), () => []);

    const nested = yield* Effect.forEach(Arr.sort(names, Order.String), (name) => {
      const file = host.path.join(directory, name);

      if (configNames.has(name)) {
        return Effect.succeed([file]);
      }

      if (name === skippedFolder || name.startsWith(".")) {
        return Effect.succeed([]);
      }

      return host.fs.stat(file).pipe(
        Effect.flatMap((info) =>
          info.type === "Directory" ? walkFrom(host, visited, file) : Effect.succeed([]),
        ),
        Effect.orElseSucceed(() => []),
      );
    });

    return nested.flat();
  });

/** The walk runs in order, one folder at a time, so each run shares one record of the folders. */
const walk = (host: Host, directory: string) =>
  Effect.suspend(() => walkFrom(host, new Set(), directory));

const down = Effect.fn("ConfigLoader.down")(function* (host: Host, start: string) {
  const listed = Option.isSome(yield* projectRoot(host, start))
    ? yield* gitFiles(host, start)
    : Option.none<ReadonlyArray<string>>();

  const candidates = Option.isSome(listed)
    ? yield* Effect.filter(
        listed.value.filter((file) => configNames.has(host.path.basename(file))),
        (file) => exists(host, file),
      )
    : yield* walk(host, start);

  const skipped = (file: string) =>
    host.path
      .relative(start, host.path.dirname(file))
      .split(host.path.sep)
      .some((part) => part === skippedFolder || part.startsWith("."));

  // One config per folder: the first extension in the order of the search.
  const byFolder = Arr.groupBy(
    candidates.filter((file) => !skipped(file)),
    (file) => host.path.dirname(file),
  );

  const found = Object.values(byFolder)
    .map((files) =>
      files.toSorted(
        (a, b) =>
          configExtensions.indexOf(host.path.extname(a)) -
          configExtensions.indexOf(host.path.extname(b)),
      ),
    )
    .flatMap((files) => files.slice(0, 1))
    .toSorted();

  return Arr.isReadonlyArrayNonEmpty(found)
    ? found
    : yield* noConfig(start, `No ${configBaseName}.ts exists in this directory or below it.`);
});

const searchFrom = (host: Host, start: string, direction: ConfigSearch) => {
  if (direction === ConfigSearch.Up) {
    return up(host, start);
  }

  return direction === ConfigSearch.Down
    ? down(host, start)
    : Effect.flatMap(projectRoot(host, start), (root) =>
        down(
          host,
          Option.getOrElse(root, () => start),
        ),
      );
};

const find = Effect.fn("ConfigLoader.find")(function* (
  host: Host,
  directory: string,
  direction: ConfigSearch,
) {
  const start = host.path.resolve(directory);
  const found = yield* searchFrom(host, start, direction);

  yield* Effect.logDebug("Envi found the configs.").pipe(
    Effect.annotateLogs({ search: direction, from: start, files: found.join(", ") }),
  );

  return found;
});

const make = Effect.gen(function* () {
  const host: Host = {
    fs: yield* FileSystem.FileSystem,
    path: yield* Path.Path,
    spawner: yield* ChildProcessSpawner,
  };

  return ConfigLoader.of({
    load: (file) => load(host, file),
    find: (directory, search) => find(host, directory, search),
  });
});

/** The config loader on top of the platform file system. */
export const layer: Layer.Layer<
  ConfigLoader,
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner
> = Layer.effect(ConfigLoader, make);
