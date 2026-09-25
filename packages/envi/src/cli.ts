import * as EffectConfig from "effect/Config";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/unstable/cli";

import {
  type AnyEnviError,
  CacheClearReport,
  CacheListReport,
  CheckReport,
  type Config,
  ConfigLoader,
  ConfigLoadError,
  ConfigLoadFailure,
  DefaultCache,
  Envi,
  ErrorReport,
  ExportFile,
  ExportFormat,
  InspectReport,
  isEnviError,
  Keychain,
  Settings,
  SyncReport,
  Timing,
} from "./core/index.ts";
import * as Package from "./core/Package.ts";
import * as Render from "./render.ts";

/** The exit code of the process. `run` sets the exit code of the child. */
export class ExitCode extends Context.Service<ExitCode, Ref.Ref<number>>()("envi/cli/ExitCode") {}

/** The keychain that holds the key of the cache. The entry point selects it from the platform. */
export class KeyStore extends Context.Service<KeyStore, Keychain.Store>()("envi/cli/KeyStore") {}

const LogFormat = { Pretty: "pretty", Json: "json" } as const;

/** The variable that holds a comma-separated list of config files. */
export const configVariable = "ENVI_CONFIG";

const failureExitCode = 1;

const root = Command.make("envi").pipe(
  Command.withDescription(
    "Resolve the env of a project once from a secret provider, cache it, and inject it.",
  ),
  Command.withSharedFlags({
    debug: Flag.Boolean("debug").pipe(
      Flag.withDescription("Show debug logs."),
      Flag.withDefault(false),
    ),
    logFormat: Flag.Literals("log-format", [LogFormat.Pretty, LogFormat.Json]).pipe(
      Flag.withDescription("The format of the logs on stderr."),
      Flag.optional,
    ),
  }),
);

const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription("Print the report as JSON on stdout."),
  Flag.withDefault(false),
);

const cacheDirFlag = Flag.String("cache-dir").pipe(
  Flag.withDescription("The directory of the cache."),
  Flag.optional,
);

/** The flags of every command that loads a config and resolves its vars. */
const resolveFlags = {
  config: Flag.String("config").pipe(
    Flag.withDescription("A config file. Repeat the flag for several files."),
    Flag.atLeast(0),
  ),
  configSearch: Flag.Literals("config-search", [
    ConfigLoader.ConfigSearch.Up,
    ConfigLoader.ConfigSearch.Down,
    ConfigLoader.ConfigSearch.Repo,
  ]).pipe(
    Flag.withDescription(
      "Where Envi looks for configs: up to the project root, down from here, or the whole repo.",
    ),
    Flag.optional,
  ),
  stage: Flag.String("stage").pipe(
    Flag.withDescription("The stage, such as development or production."),
    Flag.optional,
  ),
  refresh: Flag.Boolean("refresh").pipe(
    Flag.withDescription("Ignore fresh cache entries."),
    Flag.withDefault(false),
  ),
  strict: Flag.Boolean("strict").pipe(
    Flag.withDescription("Never use an expired cache entry."),
    Flag.optional,
  ),
  interactive: Flag.Boolean("interactive").pipe(
    Flag.withDescription(
      "Allow a prompt, such as a desktop app approval: --interactive or --no-interactive.",
    ),
    Flag.optional,
  ),
  cache: Flag.Boolean("cache").pipe(
    Flag.withDescription("Turn the cache on or off: --cache or --no-cache."),
    Flag.optional,
  ),
  cacheDir: cacheDirFlag,
};

type ResolveFlags = Command.Command.Config.Infer<typeof resolveFlags>;

/** Reads `ENVI_CONFIG`, a comma-separated list. An empty value counts as absent. */
const readConfigVariable = Effect.map(
  Effect.orElseSucceed(EffectConfig.option(EffectConfig.String(configVariable)), () =>
    Option.none<string>(),
  ),
  Option.filter((value) => value.trim() !== ""),
);

const readConfigSearch = Settings.read(
  ConfigLoader.configSearchVariable,
  "up, down, or repo",
  EffectConfig.option(
    EffectConfig.Literals(
      ConfigLoader.ConfigSearchSchema.literals,
      ConfigLoader.configSearchVariable,
    ),
  ),
);

/**
 * The config files of a command: `--config`, then `ENVI_CONFIG`, then the search. The search
 * direction comes from `--config-search`, then `ENVI_CONFIG_SEARCH`, then the command.
 */
const configFiles = Effect.fn("cli.configFiles")(function* (
  flags: ResolveFlags,
  fallback: ConfigLoader.ConfigSearch,
) {
  const loader = yield* ConfigLoader.ConfigLoader;
  const path = yield* Path.Path;

  if (flags.config.length > 0) {
    return flags.config;
  }

  const fromVariable = yield* readConfigVariable;

  if (Option.isSome(fromVariable)) {
    return fromVariable.value.split(",").map((file) => file.trim());
  }

  const fromSearchVariable = yield* readConfigSearch;

  const search = flags.configSearch.pipe(
    Option.orElse(() => fromSearchVariable),
    Option.getOrElse(() => fallback),
  );

  return yield* loader.find(path.resolve("."), search);
});

const loadConfigs = (flags: ResolveFlags, fallback: ConfigLoader.ConfigSearch) =>
  Effect.flatMap(ConfigLoader.ConfigLoader, (loader) =>
    Effect.flatMap(configFiles(flags, fallback), (files) => Effect.forEach(files, loader.load)),
  );

/** A command that works on one config rejects a list, so it never picks one at random. */
const loadOneConfig = (flags: ResolveFlags) =>
  Effect.gen(function* () {
    const files = yield* configFiles(flags, ConfigLoader.ConfigSearch.Up);
    const [file, ...rest] = files;

    if (file === undefined || rest.length > 0) {
      return yield* new ConfigLoadError({
        reason: ConfigLoadFailure.ManyConfigs,
        path: files.join(", "),
        detail: `This command uses one config, and Envi found ${files.length}.`,
      });
    }

    return yield* Effect.flatMap(ConfigLoader.ConfigLoader, (loader) => loader.load(file));
  });

/** The `Envi` service of one run. The cache settings come from the first config. */
const enviLayer = (flags: ResolveFlags, settings: Config.Config["cache"]) =>
  Layer.unwrap(
    Effect.map(KeyStore, (store) =>
      Envi.layer({
        strict: Option.getOrUndefined(flags.strict),
        interactive: Option.getOrUndefined(flags.interactive),
      }).pipe(
        Layer.provide(
          DefaultCache.layer({
            settings,
            enabled: flags.cache,
            directory: flags.cacheDir,
          }),
        ),
        Layer.provide(Keychain.layer(store)),
      ),
    ),
  );

const loadOptions = (flags: ResolveFlags) => ({
  stage: Option.getOrUndefined(flags.stage),
  refresh: flags.refresh,
});

/** Prints the report as text, or as the encoded JSON with `--json`. */
const print = <A, I>(
  json: boolean,
  schema: Schema.Codec<A, I>,
  report: A,
  render: (report: A) => string,
) =>
  json
    ? Effect.flatMap(Effect.orDie(Schema.encodeEffect(schema)(report)), (encoded) =>
        Console.log(JSON.stringify(encoded, null, 2)),
      )
    : writeStdout(render(report));

/** Writes text that already ends with a line break. */
const writeStdout = (text: string) => Console.log(text.replace(/\n$/u, ""));

const fail = Effect.flatMap(ExitCode, (code) => Ref.set(code, failureExitCode));

const sync = Command.make("sync", { ...resolveFlags, json: jsonFlag }, (flags) =>
  Effect.gen(function* () {
    const configs = yield* loadConfigs(flags, ConfigLoader.ConfigSearch.Repo);

    const report = yield* Envi.Envi.use((envi) => envi.sync(configs, loadOptions(flags))).pipe(
      Effect.provide(enviLayer(flags, configs[0]?.cache ?? Option.none())),
    );

    yield* print(flags.json, SyncReport, report, Render.sync);

    if (report.failures.length > 0) {
      yield* fail;
    }
  }).pipe(Timing.measure("command", { command: "sync" })),
).pipe(
  Command.withDescription("Resolve every var of every config in the repo and fill the cache."),
);

const check = Command.make("check", { ...resolveFlags, json: jsonFlag }, (flags) =>
  Effect.gen(function* () {
    const config = yield* loadOneConfig(flags);

    const report = yield* Envi.Envi.use((envi) => envi.check(config, loadOptions(flags))).pipe(
      Effect.provide(enviLayer(flags, config.cache)),
    );

    yield* print(flags.json, CheckReport, report, Render.check);

    if (report.failures.length > 0) {
      yield* fail;
    }
  }).pipe(Timing.measure("command", { command: "check" })),
).pipe(Command.withDescription("Resolve and validate every var. Show no value."));

const redactFlag = Flag.Boolean("redact").pipe(
  Flag.withDescription("Hide secret values: --redact or --no-redact."),
  Flag.optional,
);

const inspect = Command.make(
  "inspect",
  { ...resolveFlags, json: jsonFlag, redact: redactFlag },
  (flags) =>
    Effect.gen(function* () {
      const config = yield* loadOneConfig(flags);

      const report = yield* Envi.Envi.use((envi) =>
        envi.inspect(config, {
          ...loadOptions(flags),
          redact: Option.getOrUndefined(flags.redact),
        }),
      ).pipe(Effect.provide(enviLayer(flags, config.cache)));

      yield* print(flags.json, InspectReport, report, Render.inspect);
    }).pipe(Timing.measure("command", { command: "inspect" })),
).pipe(Command.withDescription("Show where each var comes from. Secrets are hidden by default."));

const exportCommand = Command.make(
  "export",
  {
    ...resolveFlags,
    json: jsonFlag,
    format: Flag.Literals("format", [ExportFormat.Dotenv, ExportFormat.Json]).pipe(
      Flag.withDescription("The output format."),
      Flag.withDefault(ExportFormat.Dotenv),
    ),
    redact: redactFlag,
    output: Flag.String("output").pipe(
      Flag.withDescription("Write to this file with the mode 0600."),
      Flag.optional,
    ),
  },
  (flags) =>
    Effect.gen(function* () {
      const config = yield* loadOneConfig(flags);

      const text = yield* Envi.Envi.use((envi) =>
        envi.export(config, flags.json ? ExportFormat.Json : flags.format, {
          ...loadOptions(flags),
          redact: Option.getOrUndefined(flags.redact),
        }),
      ).pipe(Effect.provide(enviLayer(flags, config.cache)));

      yield* Option.match(flags.output, {
        onNone: () => writeStdout(text),
        onSome: (file) => ExportFile.write(file, text),
      });
    }).pipe(Timing.measure("command", { command: "export" })),
).pipe(
  Command.withDescription("Print the resolved vars with real values, or write them to a file."),
);

// `run` has no `--json`: the child owns stdout.
const run = Command.make(
  "run",
  {
    ...resolveFlags,
    command: Argument.String("command").pipe(
      Argument.withDescription("The command and its arguments, after `--`."),
      Argument.variadic({ min: 1 }),
    ),
  },
  (flags) =>
    Effect.gen(function* () {
      const config = yield* loadOneConfig(flags);
      const [command = "", ...args] = flags.command;

      const report = yield* Envi.Envi.use((envi) =>
        envi.run(config, command, args, loadOptions(flags)),
      ).pipe(Effect.provide(enviLayer(flags, config.cache)));

      yield* Effect.flatMap(ExitCode, (code) => Ref.set(code, report.exitCode));
    }).pipe(Timing.measure("command", { command: "run" })),
).pipe(Command.withDescription("Run a command with the resolved vars: envi run -- bun dev"));

/**
 * The cache commands need no config and no key. They always use the directory, also in CI and
 * with the cache off, so `cache clear` removes old entries. `--cache-dir` and `ENVI_CACHE_DIR`
 * select the directory.
 */
const cacheLayer = (cacheDir: Option.Option<string>) =>
  Layer.unwrap(
    Effect.map(KeyStore, (store) =>
      Envi.layer().pipe(
        Layer.provide(
          DefaultCache.layer({
            settings: Option.none(),
            enabled: Option.some(true),
            directory: cacheDir,
          }),
        ),
        Layer.provide(Keychain.layer(store)),
      ),
    ),
  );

const cacheFlags = { cacheDir: cacheDirFlag, json: jsonFlag };

const cachePath = Command.make("path", cacheFlags, (flags) =>
  Effect.gen(function* () {
    const directory = yield* Envi.Envi.use((envi) => envi.cache.path).pipe(
      Effect.provide(cacheLayer(flags.cacheDir)),
    );

    yield* flags.json
      ? Console.log(JSON.stringify({ directory: Option.getOrNull(directory) }, null, 2))
      : Console.log(
          Option.getOrElse(
            directory,
            () => "The cache has no directory. Set HOME, ENVI_CACHE_DIR, or --cache-dir.",
          ),
        );
  }).pipe(Timing.measure("command", { command: "cache path" })),
).pipe(Command.withDescription("Print the directory of the cache."));

const cacheList = Command.make("list", cacheFlags, (flags) =>
  Effect.gen(function* () {
    const report = yield* Envi.Envi.use((envi) => envi.cache.list).pipe(
      Effect.provide(cacheLayer(flags.cacheDir)),
    );

    yield* print(flags.json, CacheListReport, report, Render.cacheList);
  }).pipe(Timing.measure("command", { command: "cache list" })),
).pipe(Command.withDescription("List the cache entries. Show no value."));

const cacheClear = Command.make("clear", cacheFlags, (flags) =>
  Effect.gen(function* () {
    const report = yield* Envi.Envi.use((envi) => envi.cache.clear).pipe(
      Effect.provide(cacheLayer(flags.cacheDir)),
    );

    yield* print(flags.json, CacheClearReport, report, Render.cacheClear);
  }).pipe(Timing.measure("command", { command: "cache clear" })),
).pipe(Command.withDescription("Remove every cache entry."));

const cache = Command.make("cache").pipe(
  Command.withDescription("Inspect and clear the cache."),
  Command.withSubcommands([cachePath, cacheList, cacheClear]),
);

/** The `envi` command with all subcommands. */
export const command = root.pipe(
  Command.withSubcommands([run, sync, inspect, check, exportCommand, cache]),
);

/** The arguments of Envi. The arguments after `--` belong to the child of `run`. */
const ownArguments = (argv: ReadonlyArray<string>): ReadonlyArray<string> => {
  const end = argv.indexOf("--");

  return end === -1 ? argv : argv.slice(0, end);
};

/** All logs go to stderr, so stdout stays clean for `export` and `--json`. */
const loggerLayer = (argv: ReadonlyArray<string>) => {
  const own = ownArguments(argv);

  const isJson =
    own.includes("--json") ||
    own.some((arg, index) => arg === "--log-format" && own[index + 1] === LogFormat.Json) ||
    own.includes(`--log-format=${LogFormat.Json}`);

  return Layer.mergeAll(
    Logger.layer([Logger.withConsoleError(isJson ? Logger.formatJson : Logger.formatLogFmt)]),
    Layer.succeed(References.MinimumLogLevel, own.includes("--debug") ? "Debug" : "Info"),
  );
};

/**
 * Prints an Envi error and sets the exit code 1. The text goes to stderr. With `--json`, the
 * encoded `ErrorReport` goes to stdout, so a program reads one JSON document in both cases.
 */
const report = (argv: ReadonlyArray<string>) => (error: AnyEnviError) =>
  Effect.andThen(
    ownArguments(argv).includes("--json")
      ? Effect.flatMap(
          Effect.orDie(Schema.encodeEffect(ErrorReport)(Envi.errorReport(error))),
          (encoded) => Console.log(JSON.stringify(encoded, null, 2)),
        )
      : Console.error(error.message),
    fail,
  );

/**
 * Runs the CLI. An expected failure prints its message on stderr and sets the exit code 1.
 *
 * @param argv - The arguments after the program name.
 * @param startupMs - The age of the process. It covers the start of the runtime and the imports.
 */
export const main = (argv: ReadonlyArray<string>, startupMs: number) =>
  Timing.report("startup", startupMs, Timing.Outcome.Success).pipe(
    Effect.andThen(Command.runWith(command, { version: Package.version })(argv)),
    Effect.catchIf(isEnviError, report(argv)),
    Effect.provide(ConfigLoader.layer),
    Effect.provide(loggerLayer(argv)),
  );
