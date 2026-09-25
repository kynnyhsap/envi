import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

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

/** Finds and loads config files. */
export interface Interface {
  /** Imports one config file. The default export must come from `defineConfig`. */
  readonly load: (file: string) => Effect.Effect<Config.Config, ConfigLoadError>;
  /** The config file of the directory, or of its nearest ancestor. `run` uses it. */
  readonly findNearest: (directory: string) => Effect.Effect<string, ConfigLoadError>;
  /**
   * The config file of the root, plus the config file of each package in `workspaces` of the root
   * `package.json`. `sync` uses it. A pattern is a path, or a path that ends with `/*`.
   */
  readonly findWorkspace: (root: string) => Effect.Effect<ReadonlyArray<string>, ConfigLoadError>;
}

/** The config loader service. */
export class ConfigLoader extends Context.Service<ConfigLoader, Interface>()("envi/ConfigLoader") {}

/** `workspaces` is a list, or an object with `packages`, as in a Bun catalog workspace. */
const PackageJson = Schema.fromJsonString(
  Schema.Struct({
    workspaces: Schema.optional(
      Schema.Union([
        Schema.Array(Schema.String),
        Schema.Struct({ packages: Schema.optional(Schema.Array(Schema.String)) }),
      ]),
    ),
  }),
);

const isPatternList = Schema.is(Schema.Array(Schema.String));

const unknownExtensionCode = "ERR_UNKNOWN_FILE_EXTENSION";

const moduleNotFoundCode = "ERR_MODULE_NOT_FOUND";

const childrenPattern = "/*";

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

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

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

  const findNearest: Interface["findNearest"] = Effect.fn("ConfigLoader.findNearest")(
    function* (directory) {
      const start = path.resolve(directory);
      let current = start;

      while (true) {
        const found = yield* configIn(current);

        if (Option.isSome(found)) {
          return found.value;
        }

        const parent = path.dirname(current);

        if (parent === current) {
          return yield* new ConfigLoadError({
            reason: ConfigLoadFailure.NoConfig,
            path: start,
            detail: `No ${configBaseName}.ts exists in this directory or in an ancestor.`,
          });
        }

        current = parent;
      }
    },
  );

  const directoriesOf = (root: string, pattern: string): Effect.Effect<ReadonlyArray<string>> => {
    if (!pattern.endsWith(childrenPattern)) {
      return Effect.succeed([path.join(root, pattern)]);
    }

    const parent = path.join(root, pattern.slice(0, -childrenPattern.length));

    return fs.readDirectory(parent).pipe(
      Effect.map((names) => names.toSorted().map((name) => path.join(parent, name))),
      Effect.orElseSucceed(() => []),
    );
  };

  const findWorkspace: Interface["findWorkspace"] = Effect.fn("ConfigLoader.findWorkspace")(
    function* (root) {
      const absolute = path.resolve(root);
      const manifest = path.join(absolute, "package.json");

      const patterns = yield* fs.readFileString(manifest).pipe(
        Effect.flatMap(Schema.decodeEffect(PackageJson)),
        Effect.map(({ workspaces }): ReadonlyArray<string> => {
          if (workspaces === undefined) {
            return [];
          }

          return isPatternList(workspaces) ? workspaces : (workspaces.packages ?? []);
        }),
        Effect.orElseSucceed((): ReadonlyArray<string> => []),
      );

      const directories = yield* Effect.forEach(patterns, (pattern) =>
        directoriesOf(absolute, pattern),
      );

      const found = yield* Effect.forEach([absolute, ...directories.flat()], configIn);

      return [...new Set(found.flatMap(Option.toArray))];
    },
  );

  return ConfigLoader.of({ load, findNearest, findWorkspace });
});

/** The config loader on top of the platform file system. */
export const layer: Layer.Layer<ConfigLoader, never, FileSystem.FileSystem | Path.Path> =
  Layer.effect(ConfigLoader, make);
