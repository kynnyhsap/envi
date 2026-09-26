import type * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";

import type * as Config from "./core/Config.ts";
import * as Envi from "./core/Envi.ts";
import type {
  CacheClearReport,
  CacheListReport,
  CheckReport,
  ExportFormat,
  InspectReport,
  RunReport,
  SyncReport,
} from "./core/Reports.ts";
import * as Source from "./core/Source.ts";
import { type EnviOptions, layer, type Services } from "./layer.ts";
import type * as Platform from "./platform.ts";

const configOf: unique symbol = Symbol.for("envi/client/config");

const runtimeOf: unique symbol = Symbol.for("envi/client/runtime");

type ClientRuntime = ManagedRuntime.ManagedRuntime<Services, never>;

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

/** The runtime of one client. The cache settings of the config apply unless the overrides replace them. */
const makeRuntime = (config: Config.Config, overrides: EnviOptions): ClientRuntime =>
  ManagedRuntime.make(
    Option.match(
      Option.orElse(Option.fromUndefinedOr(overrides.cache), () => config.cache),
      {
        onNone: () => layer(overrides),
        onSome: (cache) => layer({ ...overrides, cache }),
      },
    ),
  );

/** Creates the client of one config. The config is the single source of settings. */
export const createEnvi = <C extends Config.Config>(
  config: C,
  overrides: EnviOptions = {},
): EnviClient<C> => {
  const runtime = makeRuntime(config, overrides);

  const run = <A, E>(
    use: (envi: Envi.Interface) => Effect.Effect<A, E, Envi.ParentEnvironment | Platform.Services>,
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
