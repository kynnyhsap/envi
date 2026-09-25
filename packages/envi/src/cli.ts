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

import packageJson from "../package.json" with { type: "json" };
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
  SyncReport,
  Timing,
} from "./core/index.ts";
import * as Render from "./render.ts";

/** The exit code of the process. `run` sets the exit code of the child. */
export class ExitCode extends Context.Service<ExitCode, Ref.Ref<number>>()("envi/cli/ExitCode") {}

/** `true` on macOS, where the Keychain holds the key of the cache. The entry point provides it. */
export class KeychainAvailable extends Context.Service<KeychainAvailable, boolean>()(
  "envi/cli/KeychainAvailable",
) {}

const LogFormat = { Pretty: "pretty", Json: "json" } as const;

/** The variable that holds a comma-separated list of config files. */
export const configVariable = "ENVI_CONFIG";

const failureExitCode = 1;

const root = Command.make("envi").pipe(
  Command.withDescription(
    "Resolve the env of a project once from a secret provider, cache it, and inject it.",
  ),
  Command.withSharedFlags({
    config: Flag.String("config").pipe(
      Flag.withDescription("A config file. Repeat the flag for several files."),
      Flag.atLeast(0),
    ),
    stage: Flag.String("stage").pipe(
      Flag.withDescription("The stage, such as development or production."),
      Flag.optional,
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the report as JSON on stdout."),
      Flag.withDefault(false),
    ),
    refresh: Flag.Boolean("refresh").pipe(
      Flag.withDescription("Ignore fresh cache entries."),
      Flag.withDefault(false),
    ),
    strict: Flag.Boolean("strict").pipe(
      Flag.withDescription("Never use an expired cache entry."),
      Flag.optional,
    ),
    cache: Flag.Boolean("cache").pipe(
      Flag.withDescription("Turn the cache on or off: --cache or --no-cache."),
      Flag.optional,
    ),
    cacheDir: Flag.String("cache-dir").pipe(
      Flag.withDescription("The directory of the cache."),
      Flag.optional,
    ),
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

type Shared = Effect.Success<typeof root>;

/** The config files of a command: `--config`, then `ENVI_CONFIG`, then the search. */
const configFiles = Effect.fn("cli.configFiles")(function* (shared: Shared, workspace: boolean) {
  const loader = yield* ConfigLoader.ConfigLoader;
  const path = yield* Path.Path;
  const cwd = path.resolve(".");

  if (shared.config.length > 0) {
    return shared.config;
  }

  const fromVariable = yield* Effect.orElseSucceed(
    EffectConfig.option(EffectConfig.String(configVariable)),
    () => Option.none(),
  );

  if (Option.isSome(fromVariable)) {
    return fromVariable.value.split(",").map((file) => file.trim());
  }

  const found = workspace ? yield* loader.findWorkspace(cwd) : [];

  return found.length > 0 ? found : [yield* loader.findNearest(cwd)];
});

const loadConfigs = (shared: Shared, workspace: boolean) =>
  Effect.flatMap(ConfigLoader.ConfigLoader, (loader) =>
    Effect.flatMap(configFiles(shared, workspace), (files) => Effect.forEach(files, loader.load)),
  );

/** A command that works on one config rejects a list. */
const loadOneConfig = (shared: Shared) =>
  Effect.flatMap(loadConfigs(shared, false), (configs) => {
    const [config, ...rest] = configs;

    return config === undefined || rest.length > 0
      ? Effect.fail(
          new ConfigLoadError({
            reason: ConfigLoadFailure.InvalidConfig,
            path: shared.config.join(", "),
            detail: "This command uses one config. Pass one --config.",
          }),
        )
      : Effect.succeed(config);
  });

/** The `Envi` service of one run. The cache settings come from the first config. */
const enviLayer = (shared: Shared, settings: Config.Config["cache"]) =>
  Layer.unwrap(
    Effect.map(KeychainAvailable, (keychainAvailable) =>
      Envi.layer({ strict: Option.getOrUndefined(shared.strict) }).pipe(
        Layer.provide(
          DefaultCache.layer({
            settings,
            keychainAvailable,
            enabled: shared.cache,
            directory: shared.cacheDir,
          }),
        ),
        Layer.provide(Keychain.layer),
      ),
    ),
  );

const loadOptions = (shared: Shared) => ({
  stage: Option.getOrUndefined(shared.stage),
  refresh: shared.refresh,
});

/** Prints the report as text, or as the encoded JSON with `--json`. */
const print = <A, I>(
  shared: Shared,
  schema: Schema.Codec<A, I>,
  report: A,
  render: (report: A) => string,
) =>
  shared.json
    ? Effect.flatMap(Effect.orDie(Schema.encodeEffect(schema)(report)), (encoded) =>
        Console.log(JSON.stringify(encoded, null, 2)),
      )
    : writeStdout(render(report));

/** Writes text that already ends with a line break. */
const writeStdout = (text: string) => Console.log(text.replace(/\n$/u, ""));

const fail = Effect.flatMap(ExitCode, (code) => Ref.set(code, failureExitCode));

const sync = Command.make("sync", {}, () =>
  Effect.gen(function* () {
    const shared = yield* root;
    const configs = yield* loadConfigs(shared, true);

    const report = yield* Envi.Envi.use((envi) => envi.sync(configs, loadOptions(shared))).pipe(
      Effect.provide(enviLayer(shared, configs[0]?.cache ?? Option.none())),
    );

    yield* print(shared, SyncReport, report, Render.sync);

    if (report.failures.length > 0) {
      yield* fail;
    }
  }).pipe(Timing.measure("command", { command: "sync" })),
).pipe(Command.withDescription("Resolve every var and fill the cache."));

const check = Command.make("check", {}, () =>
  Effect.gen(function* () {
    const shared = yield* root;
    const config = yield* loadOneConfig(shared);

    const report = yield* Envi.Envi.use((envi) => envi.check(config, loadOptions(shared))).pipe(
      Effect.provide(enviLayer(shared, config.cache)),
    );

    yield* print(shared, CheckReport, report, Render.check);

    if (report.failures.length > 0) {
      yield* fail;
    }
  }).pipe(Timing.measure("command", { command: "check" })),
).pipe(Command.withDescription("Resolve and validate every var. Show no value."));

const redactFlag = Flag.Boolean("redact").pipe(
  Flag.withDescription("Hide secret values: --redact or --no-redact."),
  Flag.optional,
);

const inspect = Command.make("inspect", { redact: redactFlag }, (flags) =>
  Effect.gen(function* () {
    const shared = yield* root;
    const config = yield* loadOneConfig(shared);

    const report = yield* Envi.Envi.use((envi) =>
      envi.inspect(config, { ...loadOptions(shared), redact: Option.getOrUndefined(flags.redact) }),
    ).pipe(Effect.provide(enviLayer(shared, config.cache)));

    yield* print(shared, InspectReport, report, Render.inspect);
  }).pipe(Timing.measure("command", { command: "inspect" })),
).pipe(Command.withDescription("Show where each var comes from. Secrets are hidden by default."));

const exportCommand = Command.make(
  "export",
  {
    format: Flag.Literals("format", [ExportFormat.Dotenv, ExportFormat.Json]).pipe(
      Flag.withDescription("The output format."),
      Flag.withDefault(ExportFormat.Dotenv),
    ),
    redact: redactFlag,
    output: Flag.String("output").pipe(
      Flag.withDescription("Write to this file. Git must ignore the file."),
      Flag.optional,
    ),
  },
  (flags) =>
    Effect.gen(function* () {
      const shared = yield* root;
      const config = yield* loadOneConfig(shared);

      const text = yield* Envi.Envi.use((envi) =>
        envi.export(config, shared.json ? ExportFormat.Json : flags.format, {
          ...loadOptions(shared),
          redact: Option.getOrUndefined(flags.redact),
        }),
      ).pipe(Effect.provide(enviLayer(shared, config.cache)));

      yield* Option.match(flags.output, {
        onNone: () => writeStdout(text),
        onSome: (file) => ExportFile.write(file, text),
      });
    }).pipe(Timing.measure("command", { command: "export" })),
).pipe(
  Command.withDescription("Print the resolved vars with real values, or write them to a file."),
);

const run = Command.make(
  "run",
  {
    command: Argument.String("command").pipe(
      Argument.withDescription("The command and its arguments, after `--`."),
      Argument.variadic({ min: 1 }),
    ),
  },
  (input) =>
    Effect.gen(function* () {
      const shared = yield* root;
      const config = yield* loadOneConfig(shared);
      const [command = "", ...args] = input.command;

      const report = yield* Envi.Envi.use((envi) =>
        envi.run(config, command, args, loadOptions(shared)),
      ).pipe(Effect.provide(enviLayer(shared, config.cache)));

      yield* Effect.flatMap(ExitCode, (code) => Ref.set(code, report.exitCode));
    }).pipe(Timing.measure("command", { command: "run" })),
).pipe(Command.withDescription("Run a command with the resolved vars: envi run -- bun dev"));

/** The cache commands need no config. `--cache-dir` and `ENVI_CACHE_DIR` select the directory. */
const cacheLayer = (shared: Shared) => enviLayer(shared, Option.none());

const cachePath = Command.make("path", {}, () =>
  Effect.gen(function* () {
    const shared = yield* root;

    const directory = yield* Envi.Envi.use((envi) => envi.cache.path).pipe(
      Effect.provide(cacheLayer(shared)),
    );

    yield* shared.json
      ? Console.log(JSON.stringify({ directory: Option.getOrNull(directory) }, null, 2))
      : Console.log(Option.getOrElse(directory, () => "The cache is off."));
  }).pipe(Timing.measure("command", { command: "cache path" })),
).pipe(Command.withDescription("Print the directory of the cache."));

const cacheList = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const shared = yield* root;

    const report = yield* Envi.Envi.use((envi) => envi.cache.list).pipe(
      Effect.provide(cacheLayer(shared)),
    );

    yield* print(shared, CacheListReport, report, Render.cacheList);
  }).pipe(Timing.measure("command", { command: "cache list" })),
).pipe(Command.withDescription("List the cache entries. Show no value."));

const cacheClear = Command.make("clear", {}, () =>
  Effect.gen(function* () {
    const shared = yield* root;

    const report = yield* Envi.Envi.use((envi) => envi.cache.clear).pipe(
      Effect.provide(cacheLayer(shared)),
    );

    yield* print(shared, CacheClearReport, report, Render.cacheClear);
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

/** All logs go to stderr, so stdout stays clean for `export` and `--json`. */
const loggerLayer = (argv: ReadonlyArray<string>) => {
  const isJson =
    argv.includes("--json") ||
    argv.some((arg, index) => arg === "--log-format" && argv[index + 1] === LogFormat.Json) ||
    argv.includes(`--log-format=${LogFormat.Json}`);

  return Layer.mergeAll(
    Logger.layer([Logger.withConsoleError(isJson ? Logger.formatJson : Logger.formatLogFmt)]),
    Layer.succeed(References.MinimumLogLevel, argv.includes("--debug") ? "Debug" : "Info"),
  );
};

/**
 * Prints an Envi error and sets the exit code 1. The text goes to stderr. With `--json`, the
 * encoded `ErrorReport` goes to stdout, so a program reads one JSON document in both cases.
 */
const report = (argv: ReadonlyArray<string>) => (error: AnyEnviError) =>
  Effect.andThen(
    argv.includes("--json")
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
    Effect.andThen(Command.runWith(command, { version: packageJson.version })(argv)),
    Effect.catchIf(isEnviError, report(argv)),
    Effect.provide(ConfigLoader.layer),
    Effect.provide(loggerLayer(argv)),
  );
