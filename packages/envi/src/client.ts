import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type CacheClearReport,
  type CacheListReport,
  type CheckReport,
  type Config,
  DefaultCache,
  Envi,
  type ExportFormat,
  type InspectReport,
  Keychain,
  type Provider,
  type RunReport,
  Source,
  type SyncReport,
} from "@envi/core";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";

import * as Signals from "./signals.ts";

/** The settings of one client. They win over the config. */
export interface EnviOptions {
  /** Replaces the providers of the config. Tests pass an in-memory provider here. */
  readonly providers?: ReadonlyArray<Provider.Provider>;
  /** `false` turns the cache off. An object replaces the `cache` key of the config. */
  readonly cache?: false | Config.CacheSettings;
  readonly strict?: boolean;
}

const configOf: unique symbol = Symbol.for("envi/client/config");

const runtimeOf: unique symbol = Symbol.for("envi/client/runtime");

type ClientRuntime = ManagedRuntime.ManagedRuntime<
  Envi.Envi | Envi.ParentEnvironment | NodeServices.NodeServices,
  never
>;

/** The members that do not depend on the type of the config. `syncAll` accepts a list of them. */
export interface AnyEnvi {
  readonly [configOf]: Config.Config;
  readonly [runtimeOf]: ClientRuntime;
  /** Releases the resources of the client. A short script does not need it. */
  readonly dispose: () => Promise<void>;
}

/**
 * A client for one config. It mirrors the CLI. Each method runs the Effect of the same name on
 * the `Envi` service and rejects with the same tagged error.
 */
export interface EnviClient<C extends Config.Config> extends AnyEnvi {
  readonly load: (options?: Envi.LoadOptions<Config.StageOf<C>>) => Promise<Config.Env<C>>;
  readonly loadRaw: (options?: Envi.LoadOptions<Config.StageOf<C>>) => Promise<Config.RawEnv<C>>;
  readonly parse: (
    record: Readonly<Record<string, string | undefined>>,
    options?: { readonly stage?: Config.StageOf<C> },
  ) => Promise<Config.Env<C>>;
  readonly resolve: {
    <A, Optional extends boolean>(
      source: Source.Source<A, Optional>,
      options?: Envi.ResolveOptions,
    ): Promise<Source.Decoded<Source.Source<A, Optional>>>;
    <const R extends Readonly<Record<string, Source.AnySource>>>(
      sources: R,
      options?: Envi.ResolveOptions,
    ): Promise<Envi.ResolvedRecord<R>>;
  };
  readonly run: (
    command: string,
    args?: ReadonlyArray<string>,
    options?: Envi.RunOptions<Config.StageOf<C>>,
  ) => Promise<RunReport>;
  readonly sync: (options?: Envi.LoadOptions<Config.StageOf<C>>) => Promise<SyncReport>;
  readonly check: (options?: Envi.LoadOptions<Config.StageOf<C>>) => Promise<CheckReport>;
  readonly inspect: (options?: Envi.ExportOptions<Config.StageOf<C>>) => Promise<InspectReport>;
  readonly export: (
    format: ExportFormat,
    options?: Envi.ExportOptions<Config.StageOf<C>>,
  ) => Promise<string>;
  readonly cache: {
    /** The directory of the file cache. `undefined` without a file cache. */
    readonly path: () => Promise<string | undefined>;
    readonly list: () => Promise<CacheListReport>;
    readonly clear: () => Promise<CacheClearReport>;
  };
}

const makeRuntime = (config: Config.Config, overrides: EnviOptions): ClientRuntime => {
  const cache = DefaultCache.layer({
    settings: Option.orElse(Option.fromUndefinedOr(overrides.cache), () => config.cache),
    keychainAvailable: process.platform === "darwin",
    enabled: Option.none(),
    directory: Option.none(),
  }).pipe(Layer.provide(Keychain.layer));

  const envi = Envi.layer(overrides).pipe(Layer.provide(cache));

  return ManagedRuntime.make(
    Layer.mergeAll(envi, Signals.layer, Layer.succeed(Envi.ParentEnvironment, process.env)).pipe(
      Layer.provideMerge(NodeServices.layer),
    ),
  );
};

/** Creates the client of one config. The config is the single source of settings. */
export const createEnvi = <C extends Config.Config>(
  config: C,
  overrides: EnviOptions = {},
): EnviClient<C> => {
  const runtime = makeRuntime(config, overrides);

  const run = <A, E>(
    use: (
      envi: Envi.Interface,
    ) => Effect.Effect<A, E, Envi.ParentEnvironment | NodeServices.NodeServices>,
  ): Promise<A> => runtime.runPromise(Envi.Envi.use(use));

  function resolve<A, Optional extends boolean>(
    source: Source.Source<A, Optional>,
    options?: Envi.ResolveOptions,
  ): Promise<Source.Decoded<Source.Source<A, Optional>>>;
  function resolve<const R extends Readonly<Record<string, Source.AnySource>>>(
    sources: R,
    options?: Envi.ResolveOptions,
  ): Promise<Envi.ResolvedRecord<R>>;
  function resolve(
    input: Source.AnySource | Readonly<Record<string, Source.AnySource>>,
    options?: Envi.ResolveOptions,
    // A caller sees only the two overloads above. The implementation signature is not public.
    // oxlint-disable-next-line anti-slop/no-unknown-returns
  ): Promise<unknown> {
    return Source.isSource(input)
      ? run((envi) => envi.resolve(config, input, options))
      : run((envi) => envi.resolve(config, input, options));
  }

  return {
    [configOf]: config,
    [runtimeOf]: runtime,
    dispose: () => runtime.dispose(),
    load: (options) => run((envi) => envi.load(config, options)),
    loadRaw: (options) => run((envi) => envi.loadRaw(config, options)),
    parse: (record, options) => run((envi) => envi.parse(config, record, options)),
    resolve,
    run: (command, args, options) => run((envi) => envi.run(config, command, args, options)),
    sync: (options) => run((envi) => envi.sync(config, options)),
    check: (options) => run((envi) => envi.check(config, options)),
    inspect: (options) => run((envi) => envi.inspect(config, options)),
    export: (format, options) => run((envi) => envi.export(config, format, options)),
    cache: {
      path: () => run((envi) => envi.cache.path).then(Option.getOrUndefined),
      list: () => run((envi) => envi.cache.list),
      clear: () => run((envi) => envi.cache.clear),
    },
  };
};

/**
 * Syncs the configs of several clients in one run, with one call for each shared provider.
 * It uses the cache and the overrides of the first client.
 */
export const syncAll = (
  clients: readonly [AnyEnvi, ...ReadonlyArray<AnyEnvi>],
  options?: Envi.LoadOptions<string>,
): Promise<SyncReport> =>
  clients[0][runtimeOf].runPromise(
    Envi.Envi.use((envi) =>
      envi.sync(
        clients.map((client) => client[configOf]),
        options,
      ),
    ),
  );
