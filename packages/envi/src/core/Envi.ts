import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Tuple from "effect/Tuple";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";

import * as Cache from "./Cache.ts";
import * as CacheSettings from "./CacheSettings.ts";
import * as ChildEnvironment from "./ChildEnvironment.ts";
import * as Config from "./Config.ts";
import * as Dotenv from "./Dotenv.ts";
import {
  type CacheError,
  type ConfigLoadError,
  type ExportError,
  type ProviderError,
  RunError,
  RunFailure,
  type SettingsError,
  type UnknownStageError,
  type VarsError,
} from "./Errors.ts";
import * as Groups from "./Groups.ts";
import * as Outcomes from "./Outcomes.ts";
import * as Provider from "./Provider.ts";
import type {
  CacheClearReport,
  CacheListReport,
  CheckReport,
  ExportFormat,
  InspectReport,
  RunReport,
  SyncReport,
} from "./Reports.ts";
import * as Resolver from "./Resolver.ts";
import * as ResolveSettings from "./ResolveSettings.ts";
import * as Settings from "./Settings.ts";
import * as Signals from "./Signals.ts";
import * as Source from "./Source.ts";
import * as Timing from "./Timing.ts";

/**
 * The failures of an operation that resolves values. An operation on the vars of a config fails
 * with one `VarsError` that lists every failed var. `resolve` of one descriptor fails with the
 * error of that descriptor.
 */
export type EnviError =
  | Resolver.VarError
  | VarsError
  | ConfigLoadError
  | CacheError
  | UnknownStageError
  | SettingsError;

/** The failures of an operation that reports each failed var instead of failing. */
export type ReportError =
  | ProviderError
  | ConfigLoadError
  | CacheError
  | UnknownStageError
  | SettingsError;

/** The settings of the service. They win over the config and lose against a call option. */
export interface LayerOptions {
  /** Replaces the providers of every config. Tests pass an in-memory provider here. */
  readonly providers?: ReadonlyArray<Provider.Provider> | undefined;
  readonly strict?: boolean | undefined;
  /**
   * Allows a prompt, such as a desktop app approval. Default: `ENVI_INTERACTIVE`, then `true`
   * outside CI and `false` in CI. Without it, a provider fails at once instead of waiting.
   */
  readonly interactive?: boolean | undefined;
  /**
   * The cache flags and the `cache` option. The cache layer selects its directory with them, and
   * the service selects the policy of each config with them.
   */
  readonly cache?: CacheSettings.Overrides | undefined;
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
  ) => Effect.Effect<
    Config.Env<C>,
    VarsError | ConfigLoadError | UnknownStageError | SettingsError
  >;
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
  ) => Effect.Effect<SyncReport, ReportError>;
  /** Resolves and decodes every var, and reports each failed var. It shows no value. */
  readonly check: <C extends Config.Config>(
    config: C,
    options?: LoadOptions<Config.StageOf<C>>,
  ) => Effect.Effect<CheckReport, ReportError>;
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

/** The stage of a config: the option, then `ENVI_STAGE`, then the default stage of the config. */
const stageOf = (config: Config.Config, requested: string | undefined) =>
  Effect.flatMap(Settings.stage, (fromEnvironment) =>
    Config.selectStage(
      config,
      Option.orElse(Option.fromUndefinedOr(requested), () => fromEnvironment),
    ),
  );

/** The status of a cache layer that reports none: a cache without files that stores values. */
const activeWithoutFiles: Cache.StatusInterface = {
  directory: Option.none(),
  active: Effect.succeed(true),
};

const make = Effect.fn("Envi.make")(function* (layerOptions: LayerOptions) {
  const cache = yield* Cache.Cache;

  const status = Option.getOrElse(
    yield* Effect.serviceOption(Cache.Status),
    () => activeWithoutFiles,
  );

  const override = Option.fromUndefinedOr(layerOptions.providers);
  const cacheOverrides = layerOptions.cache ?? CacheSettings.noOverrides;

  const policyOf = (config: Config.Config) =>
    CacheSettings.selectPolicy(cacheOverrides, config.cache);

  const resolverOptions = Effect.fn("Envi.resolverOptions")(function* (
    policy: CacheSettings.Policy,
    config: Config.Config,
    stage: string,
    options: ResolveOptions | undefined,
  ) {
    const { strict, interactive } = yield* ResolveSettings.select(
      {
        callStrict: Option.fromUndefinedOr(options?.strict),
        strict: Option.fromUndefinedOr(layerOptions.strict),
        interactive: Option.fromUndefinedOr(layerOptions.interactive),
      },
      config.strict,
    );

    return {
      stage,
      refresh: options?.refresh ?? false,
      strict,
      interactive,
      ttl: policy.ttl,
      maxStale: policy.maxStale,
    } satisfies Resolver.Options;
  });

  const resolveWith = Effect.fn("Envi.resolveWith")(function* (
    config: Config.Config,
    stage: string,
    providers: ReadonlyArray<Provider.Provider>,
    sources: Readonly<Record<string, Source.AnySource>>,
    options: ResolveOptions | undefined,
  ) {
    const policy = yield* policyOf(config);
    const settings = yield* resolverOptions(policy, config, stage, options);

    return yield* Resolver.resolve(sources, settings).pipe(
      Effect.provide(Provider.layer(providers)),
      Effect.provideService(Cache.Cache, policy.enabled ? cache : Cache.none),
    );
  });

  const resolveVars = Effect.fn("Envi.resolveVars")(function* (
    config: Config.Config,
    options: LoadOptions<string> | undefined,
  ) {
    const stage = yield* stageOf(config, options?.stage);
    const sources = yield* Config.varsFor(config, stage);

    const resolution = yield* resolveWith(
      config,
      stage,
      Option.getOrElse(override, () => config.providers),
      sources,
      options,
    );

    return { stage, sources, resolution };
  });

  const load: Interface["load"] = <C extends Config.Config>(
    config: C,
    options?: LoadOptions<Config.StageOf<C>>,
  ) =>
    resolveVars(config, options).pipe(
      Effect.flatMap(({ stage, resolution }) =>
        Outcomes.allOrVarsError(config, stage, resolution.vars),
      ),
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
      Effect.flatMap(({ stage, resolution }) =>
        Outcomes.allOrVarsError(config, stage, resolution.vars),
      ),
      Effect.map((entries) => {
        const raw = Object.fromEntries(
          entries.map(([key, resolved]) => [key, Option.getOrUndefined(Outcomes.rawOf(resolved))]),
        );

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
    Effect.gen(function* () {
      const stage = yield* stageOf(config, options?.stage);
      const sources = yield* Config.varsFor(config, stage);

      const outcomes = yield* Effect.forEach(Object.entries(sources), ([key, source]) =>
        Effect.map(Effect.result(Source.parse(source, key, record[key])), (outcome) =>
          Tuple.make(key, outcome),
        ),
      );

      const entries = yield* Outcomes.allOrVarsError(config, stage, Object.fromEntries(outcomes));

      // SAFETY: TypeScript cannot relate the entries to the mapped type. Each entry holds the
      // value that the codec of the descriptor under the same key decoded.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return Object.fromEntries(entries) as Config.Env<C>;
    });

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
        ).pipe(
          Effect.flatMap((resolution) => Outcomes.allOrVarsError(config, stage, resolution.vars)),
        ),
      ),
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
      ? resolveRecord(config, { [single]: input }, options).pipe(
          Effect.map((record) => record[single]),
          // One descriptor has one failure. The caller gets it without the list around it.
          Effect.catchTag("VarsError", (error) =>
            Effect.fail(error.failures.length === 1 ? (error.failures[0]?.error ?? error) : error),
          ),
        )
      : resolveRecord(config, input, options);
  }

  const sync: Interface["sync"] = Effect.fn("Envi.sync")(function* (configs, options) {
    const startedAt = yield* Clock.currentTimeMillis;
    const list = Config.isConfig(configs) ? [configs] : configs;

    const members = yield* Effect.forEach(list, (config) =>
      Effect.gen(function* () {
        const stage = yield* stageOf(config, options?.stage);

        return {
          config,
          stage,
          providers: Option.getOrElse(override, () => config.providers),
          vars: yield* Config.varsFor(config, stage),
        } satisfies Groups.Member;
      }),
    );

    const groups = Groups.of(members);

    const resolved = yield* Effect.forEach(groups, (group) =>
      Effect.map(
        resolveWith(group.config, group.stage, group.providers, group.sources, options),
        (resolution) => ({ group, resolution }),
      ),
    );

    const policies = yield* Effect.forEach(groups, (group) => policyOf(group.config));

    const finishedAt = yield* Clock.currentTimeMillis;

    const counts = Arr.groupBy(
      resolved.flatMap(({ resolution }) => resolution.providers),
      (entry) => entry.provider,
    );

    return {
      stage: members[0]?.stage ?? Config.fallbackStage,
      configs: list.length,
      providers: Object.entries(counts).map(([provider, entries]) => ({
        provider,
        secrets: Arr.reduce(entries, 0, (sum, entry) => sum + entry.secrets),
        cached: Arr.reduce(entries, 0, (sum, entry) => sum + entry.cached),
        resolved: Arr.reduce(entries, 0, (sum, entry) => sum + entry.resolved),
      })),
      failures: resolved.flatMap(({ group, resolution }) =>
        Outcomes.failuresOf(resolution.vars, (groupKey) => Groups.originOf(group, groupKey)),
      ),
      cache: (yield* status.active) && policies.every((policy) => policy.enabled),
      durationMillis: finishedAt - startedAt,
    };
  });

  const check: Interface["check"] = (config, options) =>
    Effect.map(resolveVars(config, options), ({ stage, resolution }) => ({
      stage,
      passed: Outcomes.passedOf(resolution.vars),
      failures: Outcomes.failuresOf(resolution.vars, (key) => ({ key, config: config.path })),
    }));

  const inspect: Interface["inspect"] = Effect.fn("Envi.inspect")(function* (config, options) {
    const { stage, resolution } = yield* resolveVars(config, options);
    const entries = yield* Outcomes.allOrVarsError(config, stage, resolution.vars);
    const redact = options?.redact ?? true;

    return {
      stage,
      vars: entries.map(([key, resolved]) => Outcomes.varReportOf(key, resolved, redact)),
    };
  });

  const exportVars: Interface["export"] = Effect.fn("Envi.export")(
    function* (config, format, options) {
      const { stage, resolution } = yield* resolveVars(config, options);
      const entries = yield* Outcomes.allOrVarsError(config, stage, resolution.vars);
      const redact = options?.redact ?? false;

      return yield* Dotenv.render(format, Outcomes.rawEntries(entries, redact));
    },
  );

  const run: Interface["run"] = Effect.fn("Envi.run")(function* (config, command, args, options) {
    const { stage, resolution } = yield* resolveVars(config, options);
    const entries = yield* Outcomes.allOrVarsError(config, stage, resolution.vars);
    const parent = yield* ParentEnvironment;

    const env = ChildEnvironment.make({
      parent,
      credentialVariables: Option.getOrElse(override, () => config.providers).flatMap(
        (provider) => provider.credentialVariables,
      ),
      values: Outcomes.rawEntries(entries, false),
      stage,
    });

    const child = ChildProcess.make(command, args ?? [], {
      cwd: options?.cwd,
      env,
      extendEnv: false,
      // The child stays in the process group of Envi, so it keeps the terminal and its signals.
      detached: false,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    const failure = (reason: RunFailure) => new RunError({ reason, command });

    const exitCode = yield* Signals.supervise(child).pipe(
      Timing.measure(Timing.Step.RunChild, { command }),
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
    directory: Option.getOrNull(status.directory),
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
      path: Effect.succeed(status.directory),
      list,
      clear: Effect.map(cache.clear(), (removed) => ({ removed })),
    },
  });
});

/** The Envi service on top of a cache. Each operation uses the providers of its config. */
export const layer = (options: LayerOptions = {}): Layer.Layer<Envi, never, Cache.Cache> =>
  Layer.effect(Envi, make(options));
