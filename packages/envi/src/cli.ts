import { Argument, Command, Flag } from "effect/cli";
import * as EffectConfig from "effect/Config";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Record from "effect/Record";
import * as Ref from "effect/Ref";
import * as References from "effect/References";
import * as Schema from "effect/Schema";

import * as CacheSettings from "./core/CacheSettings.ts";
import type * as Config from "./core/Config.ts";
import * as ConfigLoader from "./core/ConfigLoader.ts";
import * as DefaultCache from "./core/DefaultCache.ts";
import * as Docs from "./core/Docs.ts";
import * as Envi from "./core/Envi.ts";
import {
  type AnyEnviError,
  ConfigLoadError,
  ConfigLoadFailure,
  isEnviError,
} from "./core/Errors.ts";
import * as ExportFile from "./core/ExportFile.ts";
import * as Keychain from "./core/Keychain.ts";
import * as Outcomes from "./core/Outcomes.ts";
import * as Package from "./core/Package.ts";
import {
  CacheClearReport,
  CacheListReport,
  CachePathReport,
  CheckReport,
  DocsListReport,
  DocsPageReport,
  DocsPathReport,
  DocsSearchReport,
  ErrorReport,
  ExportFormat,
  InspectReport,
  jsonIndent,
  SyncReport,
} from "./core/Reports.ts";
import * as Settings from "./core/Settings.ts";
import * as Timing from "./core/Timing.ts";
import * as Render from "./render.ts";

/** The exit code of the process. `run` sets the exit code of the child. */
export class ExitCode extends Context.Service<ExitCode, Ref.Ref<number>>()("envi/cli/ExitCode") {}

/** The keychain that holds the key of the cache. The entry point selects it from the platform. */
export class KeyStore extends Context.Service<KeyStore, Keychain.Store>()("envi/cli/KeyStore") {}

const LogFormat = { Pretty: "pretty", Json: "json" } as const;

/** The names of the commands. The timing line of a command names it too. */
const CommandName = {
  Root: Package.command,
  Run: "run",
  Sync: "sync",
  Check: "check",
  Inspect: "inspect",
  Export: "export",
  Cache: "cache",
  CachePath: "path",
  CacheList: "list",
  CacheClear: "clear",
  Docs: "docs",
  DocsList: "list",
  DocsShow: "show",
  DocsSearch: "search",
  DocsPath: "path",
} as const;

/** The flags that `loggerLayer` and `report` read from the arguments before the CLI parses them. */
const FlagName = { Debug: "debug", LogFormat: "log-format", Json: "json" } as const;

/** The argument that ends the options of Envi. The arguments after it belong to the child. */
const endOfOptions = "--";

const longFlag = (name: string): string => `--${name}`;

/** Times one command. */
const measureCommand = (...names: ReadonlyArray<string>) =>
  Timing.measure(Timing.Step.Command, { command: names.join(" ") });

/** The variable that holds a comma-separated list of config files. */
const configVariable = "ENVI_CONFIG";

const failureExitCode = 1;

const root = Command.make(CommandName.Root).pipe(
  Command.withDescription(
    "Resolve the env of a project once from a secret provider, cache it, and inject it.",
  ),
  Command.withSharedFlags({
    debug: Flag.Boolean(FlagName.Debug).pipe(
      Flag.withDescription("Show debug logs."),
      Flag.withDefault(false),
    ),
    logFormat: Flag.Literals(FlagName.LogFormat, Record.values(LogFormat)).pipe(
      Flag.withDescription("The format of the logs on stderr."),
      Flag.optional,
    ),
  }),
);

const jsonFlag = Flag.Boolean(FlagName.Json).pipe(
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
  configSearch: Flag.Literals("config-search", Record.values(ConfigLoader.ConfigSearch)).pipe(
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
    EffectConfig.schema(ConfigLoader.ConfigSearchSchema, ConfigLoader.configSearchVariable),
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

/**
 * The `Envi` service of one run. The cache settings come from the first config. `sync` fails when
 * another config selects another encryption or directory.
 */
const enviLayer = (flags: ResolveFlags, configKey: Config.Config["cache"]) =>
  Layer.unwrap(
    Effect.map(KeyStore, (store) => {
      const cache: CacheSettings.Overrides = {
        ...CacheSettings.noOverrides,
        enabled: flags.cache,
        directory: flags.cacheDir,
      };

      return Envi.layer({
        strict: Option.getOrUndefined(flags.strict),
        interactive: Option.getOrUndefined(flags.interactive),
        cache,
      }).pipe(
        Layer.provide(DefaultCache.layer(cache, configKey)),
        Layer.provide(Keychain.layer(store)),
      );
    }),
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
        Console.log(JSON.stringify(encoded, null, jsonIndent)),
      )
    : writeStdout(render(report));

/** Writes text that already ends with a line break. */
const writeStdout = (text: string) => Console.log(text.replace(/\n$/u, ""));

const fail = Effect.flatMap(ExitCode, (code) => Ref.set(code, failureExitCode));

const sync = Command.make(CommandName.Sync, { ...resolveFlags, json: jsonFlag }, (flags) =>
  Effect.gen(function* () {
    const configs = yield* loadConfigs(flags, ConfigLoader.ConfigSearch.Repo);

    const report = yield* Envi.Envi.use((envi) => envi.sync(configs, loadOptions(flags))).pipe(
      Effect.provide(enviLayer(flags, configs[0]?.cache ?? Option.none())),
    );

    yield* print(flags.json, SyncReport, report, Render.sync);

    if (report.failures.length > 0) {
      yield* fail;
    }
  }).pipe(measureCommand(CommandName.Sync)),
).pipe(
  Command.withDescription("Resolve every var of every config in the repo and fill the cache."),
);

const check = Command.make(CommandName.Check, { ...resolveFlags, json: jsonFlag }, (flags) =>
  Effect.gen(function* () {
    const config = yield* loadOneConfig(flags);

    const report = yield* Envi.Envi.use((envi) => envi.check(config, loadOptions(flags))).pipe(
      Effect.provide(enviLayer(flags, config.cache)),
    );

    yield* print(flags.json, CheckReport, report, Render.check);

    if (report.failures.length > 0) {
      yield* fail;
    }
  }).pipe(measureCommand(CommandName.Check)),
).pipe(Command.withDescription("Resolve and validate every var. Show no value."));

const redactFlag = Flag.Boolean("redact").pipe(
  Flag.withDescription("Hide secret values: --redact or --no-redact."),
  Flag.optional,
);

const inspect = Command.make(
  CommandName.Inspect,
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
    }).pipe(measureCommand(CommandName.Inspect)),
).pipe(Command.withDescription("Show where each var comes from. Secrets are hidden by default."));

const exportCommand = Command.make(
  CommandName.Export,
  {
    ...resolveFlags,
    json: jsonFlag,
    format: Flag.Literals("format", Record.values(ExportFormat)).pipe(
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
    }).pipe(measureCommand(CommandName.Export)),
).pipe(
  Command.withDescription("Print the resolved vars with real values, or write them to a file."),
);

// `run` has no `--json`: the child owns stdout.
const run = Command.make(
  CommandName.Run,
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
    }).pipe(measureCommand(CommandName.Run)),
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
          DefaultCache.layer(
            { ...CacheSettings.noOverrides, enabled: Option.some(true), directory: cacheDir },
            Option.none(),
          ),
        ),
        Layer.provide(Keychain.layer(store)),
      ),
    ),
  );

const cacheFlags = { cacheDir: cacheDirFlag, json: jsonFlag };

const cachePath = Command.make(CommandName.CachePath, cacheFlags, (flags) =>
  Effect.gen(function* () {
    const directory = yield* Envi.Envi.use((envi) => envi.cache.path).pipe(
      Effect.provide(cacheLayer(flags.cacheDir)),
    );

    yield* print(
      flags.json,
      CachePathReport,
      { directory: Option.getOrNull(directory) },
      (report) =>
        report.directory ?? "The cache has no directory. Set HOME, ENVI_CACHE_DIR, or --cache-dir.",
    );
  }).pipe(measureCommand(CommandName.Cache, CommandName.CachePath)),
).pipe(Command.withDescription("Print the directory of the cache."));

const cacheList = Command.make(CommandName.CacheList, cacheFlags, (flags) =>
  Effect.gen(function* () {
    const report = yield* Envi.Envi.use((envi) => envi.cache.list).pipe(
      Effect.provide(cacheLayer(flags.cacheDir)),
    );

    yield* print(flags.json, CacheListReport, report, Render.cacheList);
  }).pipe(measureCommand(CommandName.Cache, CommandName.CacheList)),
).pipe(Command.withDescription("List the cache entries. Show no value."));

const cacheClear = Command.make(CommandName.CacheClear, cacheFlags, (flags) =>
  Effect.gen(function* () {
    const report = yield* Envi.Envi.use((envi) => envi.cache.clear).pipe(
      Effect.provide(cacheLayer(flags.cacheDir)),
    );

    yield* print(flags.json, CacheClearReport, report, Render.cacheClear);
  }).pipe(measureCommand(CommandName.Cache, CommandName.CacheClear)),
).pipe(Command.withDescription("Remove every cache entry."));

const cache = Command.make(CommandName.Cache).pipe(
  Command.withDescription("Inspect and clear the cache."),
  Command.withSubcommands([cachePath, cacheList, cacheClear]),
);

/** The docs folder of this Envi: `docs` next to `dist` in the package, and next to `src` in the repo. */
const docsFolder = new URL("../docs/", import.meta.url);

const docsLayer = Layer.unwrap(
  Effect.flatMap(Path.Path, (path) =>
    Effect.map(Effect.orDie(path.fromFileUrl(docsFolder)), (folder) =>
      Docs.layer(path.resolve(folder), Package.docsUrl),
    ),
  ),
).pipe(Layer.provide(FetchHttpClient.layer));

const docsList = Command.make(CommandName.DocsList, { json: jsonFlag }, (flags) =>
  Effect.gen(function* () {
    const docs = yield* Docs.Docs;
    const pages = yield* docs.list;

    yield* print(flags.json, DocsListReport, { folder: docs.folder, pages }, Render.docsList);
  }).pipe(measureCommand(CommandName.Docs, CommandName.DocsList)),
).pipe(Command.withDescription("List every docs page with its description."));

const pageArgument = Argument.String("page").pipe(
  Argument.withDescription(
    "A page name such as errors/vars, its file name, or the docs link of an error.",
  ),
);

const docsShow = Command.make(
  CommandName.DocsShow,
  { page: pageArgument, json: jsonFlag },
  (input) =>
    Effect.gen(function* () {
      const page = yield* Docs.Docs.use((docs) => docs.show(input.page));

      yield* print(input.json, DocsPageReport, page, (report) => report.text);
    }).pipe(measureCommand(CommandName.Docs, CommandName.DocsShow)),
).pipe(Command.withDescription("Print one docs page as Markdown."));

const docsSearch = Command.make(
  CommandName.DocsSearch,
  {
    words: Argument.String("words").pipe(
      Argument.withDescription("The words that each page must hold."),
      Argument.variadic({ min: 1 }),
    ),
    json: jsonFlag,
  },
  (input) =>
    Effect.gen(function* () {
      const query = input.words.join(" ");
      const pages = yield* Docs.Docs.use((docs) => docs.search(query));

      yield* print(input.json, DocsSearchReport, { query, pages }, Render.docsSearch);
    }).pipe(measureCommand(CommandName.Docs, CommandName.DocsSearch)),
).pipe(Command.withDescription("Find the docs pages that hold every word."));

const docsPath = Command.make(
  CommandName.DocsPath,
  { page: pageArgument.pipe(Argument.optional), json: jsonFlag },
  (input) =>
    Effect.gen(function* () {
      const path = yield* Docs.Docs.use((docs) => docs.path(input.page));

      yield* print(input.json, DocsPathReport, { path }, (report) => report.path);
    }).pipe(measureCommand(CommandName.Docs, CommandName.DocsPath)),
).pipe(Command.withDescription("Print the docs folder, or the file of one page."));

const docs = Command.make(CommandName.Docs, {}, () =>
  Effect.gen(function* () {
    const index = yield* Docs.Docs.use((service) => service.show(Docs.indexPage));

    yield* writeStdout(index.text);
  }).pipe(measureCommand(CommandName.Docs)),
).pipe(
  Command.withDescription(
    "Read the docs of this Envi offline. Without a subcommand, print the index.",
  ),
  Command.withSubcommands([docsList, docsShow, docsSearch, docsPath]),
  Command.provide(docsLayer),
);

/** The `envi` command with all subcommands. */
const command = root.pipe(
  Command.withSubcommands([run, sync, inspect, check, exportCommand, cache, docs]),
);

/** The arguments of Envi. The arguments after `--` belong to the child of `run`. */
const ownArguments = (argv: ReadonlyArray<string>): ReadonlyArray<string> => {
  const end = argv.indexOf(endOfOptions);

  return end === -1 ? argv : argv.slice(0, end);
};

/** All logs go to stderr, so stdout stays clean for `export` and `--json`. */
const loggerLayer = (argv: ReadonlyArray<string>) => {
  const own = ownArguments(argv);

  const isJson =
    own.includes(longFlag(FlagName.Json)) ||
    own.some(
      (arg, index) => arg === longFlag(FlagName.LogFormat) && own[index + 1] === LogFormat.Json,
    ) ||
    own.includes(`${longFlag(FlagName.LogFormat)}=${LogFormat.Json}`);

  return Layer.mergeAll(
    Logger.layer([Logger.withConsoleError(isJson ? Logger.formatJson : Logger.formatLogFmt)]),
    Layer.succeed(
      References.MinimumLogLevel,
      own.includes(longFlag(FlagName.Debug)) ? "Debug" : "Info",
    ),
  );
};

/**
 * Prints an Envi error and sets the exit code 1. The text goes to stderr. With `--json`, the
 * encoded `ErrorReport` goes to stdout, so a program reads one JSON document in both cases.
 */
const report = (argv: ReadonlyArray<string>) => (error: AnyEnviError) =>
  Effect.andThen(
    ownArguments(argv).includes(longFlag(FlagName.Json))
      ? Effect.flatMap(
          Effect.orDie(Schema.encodeEffect(ErrorReport)(Outcomes.errorReport(error))),
          (encoded) => Console.log(JSON.stringify(encoded, null, jsonIndent)),
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
  Timing.report(Timing.Step.Startup, startupMs, Timing.Outcome.Success).pipe(
    Effect.andThen(Command.runWith(command, { version: Package.version })(argv)),
    Effect.catchIf(isEnviError, report(argv)),
    Effect.provide(ConfigLoader.layer),
    Effect.provide(loggerLayer(argv)),
  );
