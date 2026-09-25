import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as EffectConfig from "effect/Config";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";

import * as Cache from "./Cache.ts";
import * as Config from "./Config.ts";
import {
  type CacheError,
  DecodeError,
  ExportError,
  type ProviderError,
  RunError,
  RunFailure,
  SettingsError,
  type UnknownStageError,
} from "./Errors.ts";
import * as Provider from "./Provider.ts";
import {
  type CacheClearReport,
  type CacheListReport,
  type CheckReport,
  ExportFormat,
  type InspectReport,
  type RunReport,
  type SyncReport,
  type VarFailure,
} from "./Reports.ts";
import * as Resolver from "./Resolver.ts";
import * as Signals from "./Signals.ts";
import * as Source from "./Source.ts";
import * as Timing from "./Timing.ts";

/** The failures of an operation that resolves values. */
export type EnviError = Resolver.VarError | CacheError | UnknownStageError | SettingsError;

/** The settings of the service. They win over the config and lose against a call option. */
export interface LayerOptions {
  /** Replaces the providers of every config. Tests pass an in-memory provider here. */
  readonly providers?: ReadonlyArray<Provider.Provider> | undefined;
  readonly strict?: boolean | undefined;
}

/** The options of one resolution. */
export interface ResolveOptions {
  /** Ignores fresh cache entries. */
  readonly refresh?: boolean | undefined;
  /** Disables the stale fallback. */
  readonly strict?: boolean | undefined;
}

/** The options of an operation on the vars of one stage. */
export interface LoadOptions<Stage extends string> extends ResolveOptions {
  readonly stage?: Stage | undefined;
}

/** The options of `inspect` and `export`. */
export interface ExportOptions<Stage extends string> extends LoadOptions<Stage> {
  /** Hides each redacted value. `inspect` hides by default. `export` shows by default. */
  readonly redact?: boolean | undefined;
}

/** The options of `run`. */
export interface RunOptions<Stage extends string> extends LoadOptions<Stage> {
  /** The working directory of the child process. */
  readonly cwd?: string | undefined;
}

/**
 * The environment of the Envi process. `run` builds the environment of the child from it. The
 * entry point provides it, because the core never reads `process.env`.
 */
export class ParentEnvironment extends Context.Service<
  ParentEnvironment,
  Readonly<Record<string, string | undefined>>
>()("envi/ParentEnvironment") {}

/** The decoded values of a record of descriptors. */
export type ResolvedRecord<R extends Readonly<Record<string, Source.AnySource>>> = {
  readonly [K in keyof R]: Source.Decoded<R[K]>;
};

/**
 * The operations of Envi. Each one takes the config as an argument, because a service cannot
 * carry a type parameter. The plain client binds one config instead.
 */
export interface Interface {
  /** Resolves every var and returns the decoded values. Fails with the first failed var. */
  readonly load: <C extends Config.Config>(
    config: C,
    options?: LoadOptions<Config.StageOf<C>>,
  ) => Effect.Effect<Config.Env<C>, EnviError>;
  /** Resolves every var and returns the raw strings. The caller assigns them to an environment. */
  readonly loadRaw: <C extends Config.Config>(
    config: C,
    options?: LoadOptions<Config.StageOf<C>>,
  ) => Effect.Effect<Config.RawEnv<C>, EnviError>;
  /** Decodes strings that already exist, such as `process.env`. It never calls a provider. */
  readonly parse: <C extends Config.Config>(
    config: C,
    record: Readonly<Record<string, string | undefined>>,
    options?: { readonly stage?: Config.StageOf<C> },
  ) => Effect.Effect<Config.Env<C>, DecodeError | UnknownStageError | SettingsError>;
  /** Resolves one descriptor, or a record of descriptors in one batch. */
  readonly resolve: {
    <A, Optional extends boolean>(
      config: Config.Config,
      source: Source.Source<A, Optional>,
      options?: ResolveOptions,
    ): Effect.Effect<Source.Decoded<Source.Source<A, Optional>>, EnviError>;
    <const R extends Readonly<Record<string, Source.AnySource>>>(
      config: Config.Config,
      sources: R,
      options?: ResolveOptions,
    ): Effect.Effect<ResolvedRecord<R>, EnviError>;
  };
  /** Fills the cache. A list of configs gives one call for each shared provider. */
  readonly sync: (
    configs: Config.Config | ReadonlyArray<Config.Config>,
    options?: LoadOptions<string>,
  ) => Effect.Effect<SyncReport, ProviderError | CacheError | UnknownStageError | SettingsError>;
  /** Resolves and decodes every var, and reports each failed var. It shows no value. */
  readonly check: <C extends Config.Config>(
    config: C,
    options?: LoadOptions<Config.StageOf<C>>,
  ) => Effect.Effect<CheckReport, ProviderError | CacheError | UnknownStageError | SettingsError>;
  readonly inspect: <C extends Config.Config>(
    config: C,
    options?: ExportOptions<Config.StageOf<C>>,
  ) => Effect.Effect<InspectReport, EnviError>;
  readonly export: <C extends Config.Config>(
    config: C,
    format: ExportFormat,
    options?: ExportOptions<Config.StageOf<C>>,
  ) => Effect.Effect<string, EnviError | ExportError>;
  /**
   * Resolves every var, and then starts the command with the parent environment plus the vars.
   * A failed var starts no child. The report holds the exit code of the child.
   */
  readonly run: <C extends Config.Config>(
    config: C,
    command: string,
    args?: ReadonlyArray<string>,
    options?: RunOptions<Config.StageOf<C>>,
  ) => Effect.Effect<RunReport, EnviError | RunError, ChildProcessSpawner | ParentEnvironment>;
  readonly cache: {
    /** The directory of a file cache. */
    readonly path: Effect.Effect<Option.Option<string>>;
    readonly list: Effect.Effect<CacheListReport, CacheError>;
    readonly clear: Effect.Effect<CacheClearReport, CacheError>;
  };
}

/** The Envi service. */
export class Envi extends Context.Service<Envi, Interface>()("envi/Envi") {}

/** The default refresh interval of a cache entry. */
export const defaultTtl: Duration.Input = "24 hours";

/** The default limit of the stale fallback. */
export const defaultMaxStale: Duration.Input = "7 days";

/** The text that a redacted export shows in place of a secret. */
export const redactedText = "<redacted>";

/** The variable that selects the stage. `run` sets it for the child. */
export const stageVariable = "ENVI_STAGE";

/** `run` removes every variable with this prefix from the child, because it can hold a credential. */
export const providerVariablePrefix = "ENVI_PROVIDER_";

/** `run` removes the token of the 1Password service account from the child. */
const withheldVariables: ReadonlyArray<string> = ["OP_SERVICE_ACCOUNT_TOKEN"];

const strictVariable = "ENVI_STRICT";

const ciVariable = "CI";

const readSetting = <A>(
  name: string,
  expected: string,
  setting: EffectConfig.Config<A>,
): Effect.Effect<A, SettingsError> =>
  Effect.mapError(setting, () => new SettingsError({ name, expected }));

const readStage = readSetting(
  stageVariable,
  "a stage name",
  EffectConfig.option(EffectConfig.String(stageVariable)),
);

const readStrict = readSetting(
  strictVariable,
  "true or false",
  EffectConfig.option(EffectConfig.Boolean(strictVariable)),
);

const readCi = readSetting(
  ciVariable,
  "true or false",
  EffectConfig.withDefault(EffectConfig.Boolean(ciVariable), false),
);

const failureOf = (key: string, error: Resolver.VarError): VarFailure =>
  Match.valueTags(error, {
    DecodeError: (failure) => ({
      key,
      reference: null,
      error: failure._tag,
      reason: failure.expected,
    }),
    ProviderError: (failure) => ({
      key,
      reference: null,
      error: failure._tag,
      reason: failure.reason,
    }),
    CustomError: (failure) => ({
      key,
      reference: `custom(${failure.id})`,
      error: failure._tag,
      reason: failure.reason,
    }),
    DeriveError: (failure) => ({
      key,
      reference: null,
      error: failure._tag,
      reason: "Threw",
    }),
    ReferenceError: (failure) => ({
      key,
      reference: failure.reference,
      error: failure._tag,
      reason: failure.reason,
    }),
  });

const safeDotenv = /^[\w./:@+=,-]*$/u;

const dotenvLine = (key: string, raw: string): Effect.Effect<string, ExportError> => {
  if (safeDotenv.test(raw)) {
    return Effect.succeed(`${key}=${raw}`);
  }

  if (!/['\n\r]/u.test(raw)) {
    return Effect.succeed(`${key}='${raw}'`);
  }

  // Parsers disagree about escapes and expansion inside double quotes. Envi writes only `\n`.
  return /["$\\`\r]/u.test(raw)
    ? Effect.fail(new ExportError({ key, format: ExportFormat.Dotenv }))
    : Effect.succeed(`${key}="${raw.replaceAll("\n", "\\n")}"`);
};

/** Every var in the order of the config, or the first failure. */
const allOrFirstFailure = (resolution: Resolver.Resolution) =>
  Effect.forEach(Object.entries(resolution.vars), ([key, outcome]) =>
    Result.match(outcome, {
      onFailure: (error) => Effect.fail(error),
      onSuccess: (resolved) => Effect.succeed([key, resolved] as const),
    }),
  );

const rawOf = (resolved: Resolver.Resolved): string | undefined =>
  Option.getOrUndefined(Option.map(resolved.raw, Redacted.value));

const parseOne = (
  key: string,
  source: Source.AnySource,
  found: string | undefined,
): Effect.Effect<unknown, DecodeError> => {
  const raw = Option.fromUndefinedOr(found).pipe(
    Option.orElse(() =>
      Source.Origin.$is("Literal")(source.origin)
        ? Option.some(source.origin.value)
        : source.fallback,
    ),
  );

  if (Option.isSome(raw)) {
    return Source.decode(source, key, raw.value);
  }

  return source.isOptional
    ? Effect.void
    : Effect.fail(new DecodeError({ key, expected: "a value. The variable is not set" }));
};

interface Group {
  /** The config of the first member. Its cache settings apply to the group. */
  readonly config: Config.Config;
  readonly stage: string;
  readonly providers: Map<string, Provider.Provider>;
  readonly sources: Record<string, Source.AnySource>;
}

const make = Effect.fn("Envi.make")(function* (layerOptions: LayerOptions) {
  const cache = yield* Cache.Cache;
  const override = Option.fromUndefinedOr(layerOptions.providers);

  const stageOf = (config: Config.Config, requested: string | undefined) =>
    Effect.flatMap(readStage, (fromEnvironment) =>
      Config.selectStage(
        config,
        Option.orElse(Option.fromUndefinedOr(requested), () => fromEnvironment),
      ),
    );

  const resolverOptions = Effect.fn("Envi.resolverOptions")(function* (
    config: Config.Config,
    stage: string,
    options: ResolveOptions | undefined,
  ) {
    const isCi = yield* readCi;
    const strictFromEnvironment = yield* readStrict;

    const strict = Option.fromUndefinedOr(options?.strict).pipe(
      Option.orElse(() => Option.fromUndefinedOr(layerOptions.strict)),
      Option.orElse(() => strictFromEnvironment),
      Option.orElse(() => config.strict),
      Option.getOrElse(() => false),
    );

    const settings = Option.filter(config.cache, (value) => value !== false);

    return {
      stage,
      refresh: options?.refresh ?? false,
      // CI is always strict.
      strict: isCi || strict,
      interactive: !isCi,
      ttl: Option.getOrElse(
        Option.flatMap(settings, (value) => Option.fromUndefinedOr(value.ttl)),
        () => defaultTtl,
      ),
      maxStale: Option.getOrElse(
        Option.flatMap(settings, (value) => Option.fromUndefinedOr(value.maxStale)),
        () => defaultMaxStale,
      ),
    } satisfies Resolver.Options;
  });

  const resolveWith = (
    config: Config.Config,
    stage: string,
    providers: ReadonlyArray<Provider.Provider>,
    sources: Readonly<Record<string, Source.AnySource>>,
    options: ResolveOptions | undefined,
  ) =>
    Effect.flatMap(resolverOptions(config, stage, options), (settings) =>
      Resolver.resolve(sources, settings).pipe(
        Effect.provide(Provider.layer(providers)),
        Option.contains(config.cache, false)
          ? Effect.provide(Cache.layerNone)
          : Effect.provideService(Cache.Cache, cache),
      ),
    );

  const resolveVars = Effect.fn("Envi.resolveVars")(function* (
    config: Config.Config,
    options: LoadOptions<string> | undefined,
  ) {
    const stage = yield* stageOf(config, options?.stage);
    const sources = Config.varsFor(config, stage);

    const resolution = yield* resolveWith(
      config,
      stage,
      Option.getOrElse(override, () => config.providers),
      sources,
      options,
    );

    return { stage, sources, resolution };
  });

  const failuresOf = (resolution: Resolver.Resolution): ReadonlyArray<VarFailure> =>
    Object.entries(resolution.vars).flatMap(([key, outcome]) =>
      Result.isFailure(outcome) ? [failureOf(key, outcome.failure)] : [],
    );

  const load: Interface["load"] = <C extends Config.Config>(
    config: C,
    options?: LoadOptions<Config.StageOf<C>>,
  ) =>
    resolveVars(config, options).pipe(
      Effect.flatMap(({ resolution }) => allOrFirstFailure(resolution)),
      Effect.map((entries) => {
        const env = Object.fromEntries(entries.map(([key, resolved]) => [key, resolved.decoded]));

        // SAFETY: TypeScript cannot relate the entries to the mapped type. Each entry holds the
        // value that the codec of the descriptor under the same key decoded.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return env as Config.Env<C>;
      }),
    );

  const loadRaw: Interface["loadRaw"] = <C extends Config.Config>(
    config: C,
    options?: LoadOptions<Config.StageOf<C>>,
  ) =>
    resolveVars(config, options).pipe(
      Effect.flatMap(({ resolution }) => allOrFirstFailure(resolution)),
      Effect.map((entries) => {
        const raw = Object.fromEntries(entries.map(([key, resolved]) => [key, rawOf(resolved)]));

        // SAFETY: TypeScript cannot relate the entries to the mapped type. A raw value is a
        // string, and it is absent only for an optional descriptor.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return raw as Config.RawEnv<C>;
      }),
    );

  const parse: Interface["parse"] = <C extends Config.Config>(
    config: C,
    record: Readonly<Record<string, string | undefined>>,
    options?: { readonly stage?: Config.StageOf<C> },
  ) =>
    stageOf(config, options?.stage).pipe(
      Effect.flatMap((stage) =>
        Effect.forEach(Object.entries(Config.varsFor(config, stage)), ([key, source]) =>
          Effect.map(parseOne(key, source, record[key]), (decoded) => [key, decoded] as const),
        ),
      ),
      // SAFETY: TypeScript cannot relate the entries to the mapped type. Each entry holds the
      // value that the codec of the descriptor under the same key decoded.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      Effect.map((entries) => Object.fromEntries(entries) as Config.Env<C>),
    );

  const resolveRecord = (
    config: Config.Config,
    sources: Readonly<Record<string, Source.AnySource>>,
    options: ResolveOptions | undefined,
  ) =>
    stageOf(config, undefined).pipe(
      Effect.flatMap((stage) =>
        resolveWith(
          config,
          stage,
          Option.getOrElse(override, () => config.providers),
          sources,
          options,
        ),
      ),
      Effect.flatMap(allOrFirstFailure),
      Effect.map((entries) =>
        Object.fromEntries(entries.map(([key, resolved]) => [key, resolved.decoded])),
      ),
    );

  const single = "value";

  function resolve<A, Optional extends boolean>(
    config: Config.Config,
    source: Source.Source<A, Optional>,
    options?: ResolveOptions,
  ): Effect.Effect<Source.Decoded<Source.Source<A, Optional>>, EnviError>;
  function resolve<const R extends Readonly<Record<string, Source.AnySource>>>(
    config: Config.Config,
    sources: R,
    options?: ResolveOptions,
  ): Effect.Effect<ResolvedRecord<R>, EnviError>;
  function resolve(
    config: Config.Config,
    input: Source.AnySource | Readonly<Record<string, Source.AnySource>>,
    options?: ResolveOptions,
  ): Effect.Effect<unknown, EnviError> {
    return Source.isSource(input)
      ? Effect.map(resolveRecord(config, { [single]: input }, options), (record) => record[single])
      : resolveRecord(config, input, options);
  }

  const sync: Interface["sync"] = Effect.fn("Envi.sync")(function* (configs, options) {
    const startedAt = yield* Clock.currentTimeMillis;
    const list = Config.isConfig(configs) ? [configs] : configs;
    const groups: Array<Group> = [];
    let firstStage = Option.none<string>();

    for (const [index, config] of list.entries()) {
      const stage = yield* stageOf(config, options?.stage);
      const providers = Option.getOrElse(override, () => config.providers);

      firstStage = Option.orElse(firstStage, () => Option.some(stage));

      // Configs share a group while they share the stage and no two of them bind one provider
      // id to two instances.
      const fitting = groups.find(
        (group) =>
          group.stage === stage &&
          providers.every(
            (provider) => (group.providers.get(provider.id) ?? provider) === provider,
          ),
      );

      const group: Group = fitting ?? { config, stage, providers: new Map(), sources: {} };

      if (fitting === undefined) {
        groups.push(group);
      }

      for (const provider of providers) {
        group.providers.set(provider.id, provider);
      }

      for (const [key, source] of Object.entries(Config.varsFor(config, stage))) {
        group.sources[list.length === 1 ? key : `${index}:${key}`] = source;
      }
    }

    const resolutions = yield* Effect.forEach(groups, (group) =>
      resolveWith(group.config, group.stage, [...group.providers.values()], group.sources, options),
    );

    const finishedAt = yield* Clock.currentTimeMillis;

    const counts = Arr.groupBy(
      resolutions.flatMap((resolution) => resolution.providers),
      (entry) => entry.provider,
    );

    return {
      stage: Option.getOrElse(firstStage, () => Config.fallbackStage),
      configs: list.length,
      providers: Object.entries(counts).map(([provider, entries]) => ({
        provider,
        secrets: Arr.reduce(entries, 0, (sum, entry) => sum + entry.secrets),
        cached: Arr.reduce(entries, 0, (sum, entry) => sum + entry.cached),
        resolved: Arr.reduce(entries, 0, (sum, entry) => sum + entry.resolved),
      })),
      failures: resolutions.flatMap(failuresOf),
      durationMillis: finishedAt - startedAt,
    };
  });

  const check: Interface["check"] = (config, options) =>
    Effect.map(resolveVars(config, options), ({ stage, resolution }) => ({
      stage,
      passed: Object.entries(resolution.vars).flatMap(([key, outcome]) =>
        Result.isSuccess(outcome) ? [key] : [],
      ),
      failures: failuresOf(resolution),
    }));

  const inspect: Interface["inspect"] = Effect.fn("Envi.inspect")(function* (config, options) {
    const { stage, resolution } = yield* resolveVars(config, options);
    const entries = yield* allOrFirstFailure(resolution);
    const redact = options?.redact ?? true;

    return {
      stage,
      vars: entries.map(([key, resolved]) => {
        const redacted = redact && resolved.isRedacted;

        return {
          key,
          provider: Option.getOrNull(resolved.provider),
          reference: Option.getOrNull(resolved.reference),
          origin: resolved.origin,
          resolvedAt: Option.getOrNull(
            Option.map(resolved.resolvedAt, (millis) => new Date(millis).toISOString()),
          ),
          redacted,
          value: redacted ? null : (rawOf(resolved) ?? null),
        };
      }),
    };
  });

  const exportVars: Interface["export"] = Effect.fn("Envi.export")(
    function* (config, format, options) {
      const { resolution } = yield* resolveVars(config, options);
      const entries = yield* allOrFirstFailure(resolution);
      const redact = options?.redact ?? false;

      const values = entries.flatMap(([key, resolved]) =>
        Option.match(resolved.raw, {
          onNone: () => [],
          onSome: (raw) => [
            [key, redact && resolved.isRedacted ? redactedText : Redacted.value(raw)] as const,
          ],
        }),
      );

      if (format === ExportFormat.Json) {
        return `${JSON.stringify(Object.fromEntries(values), null, 2)}\n`;
      }

      const lines = yield* Effect.forEach(values, ([key, raw]) => dotenvLine(key, raw));

      return `${lines.join("\n")}\n`;
    },
  );

  const run: Interface["run"] = Effect.fn("Envi.run")(function* (config, command, args, options) {
    const { stage, resolution } = yield* resolveVars(config, options);
    const entries = yield* allOrFirstFailure(resolution);
    const parent = yield* ParentEnvironment;

    const inherited = Object.entries(parent).filter(
      ([name]) => !name.startsWith(providerVariablePrefix) && !withheldVariables.includes(name),
    );

    const resolved = entries.flatMap(([key, value]) =>
      Option.match(value.raw, {
        onNone: () => [],
        onSome: (raw) => [[key, Redacted.value(raw)] as const],
      }),
    );

    const child = ChildProcess.make(command, args ?? [], {
      cwd: options?.cwd,
      env: Object.fromEntries([...inherited, ...resolved, [stageVariable, stage]]),
      extendEnv: false,
      // The child stays in the process group of Envi, so it keeps the terminal and its signals.
      detached: false,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    const failure = (reason: RunFailure) => new RunError({ reason, command });

    const exitCode = yield* Signals.supervise(child).pipe(
      Timing.measure("run.child", { command }),
      Effect.mapError((error) =>
        failure(
          Match.value(error.reason).pipe(
            Match.tag("NotFound", () => RunFailure.CommandNotFound),
            Match.tag("PermissionDenied", () => RunFailure.CommandNotExecutable),
            Match.orElse(() => RunFailure.SpawnFailed),
          ),
        ),
      ),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(failure(RunFailure.KilledBySignal)),
          onSome: (code) => Effect.succeed(code),
        }),
      ),
    );

    return { exitCode };
  });

  const list: Interface["cache"]["list"] = Effect.map(cache.list(), (entries) => ({
    directory: Option.getOrNull(cache.directory),
    entries: entries
      .toSorted((left, right) => left.reference.localeCompare(right.reference))
      .map((entry) => ({
        provider: entry.provider,
        reference: entry.reference,
        resolvedAt: new Date(entry.resolvedAt).toISOString(),
      })),
  }));

  return Envi.of({
    load,
    loadRaw,
    parse,
    resolve,
    sync,
    check,
    inspect,
    export: exportVars,
    run,
    cache: {
      path: Effect.succeed(cache.directory),
      list,
      clear: Effect.map(cache.clear(), (removed) => ({ removed })),
    },
  });
});

/** The Envi service on top of a cache. Each operation uses the providers of its config. */
export const layer = (options: LayerOptions = {}): Layer.Layer<Envi, never, Cache.Cache> =>
  Layer.effect(Envi, make(options));
