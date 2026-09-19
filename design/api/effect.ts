// Type-only sketch of the Effect entry point.
import type * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Layer from "effect/Layer";
import type * as Path from "effect/Path";
import type * as Result from "effect/Result";
import type * as Schema from "effect/Schema";
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import type {
  AnySource,
  CacheClearReport,
  CacheListReport,
  CacheRecord,
  CheckReport,
  Config,
  Env,
  EnviOptions,
  ExportFormat,
  ExportOptions,
  InspectReport,
  LoadOptions,
  Provider as ProviderHandle,
  ProviderRequest,
  RawEnv,
  ResolveContext,
  ResolveOptions,
  RunOptions,
  RunReport,
  Source,
  StageOf,
  SyncReport,
} from "envi";

/** One reference failed. `reference` holds the `describe()` text and never a secret. */
export declare class ReferenceError extends Schema.TaggedError<ReferenceError>()("ReferenceError", {
  reason: Schema.Literals(["NotFound", "Invalid", "AccessDenied"]),
  reference: Schema.String,
}) {}

/** A whole provider call failed. Only `Unavailable` allows the stale fallback. */
export declare class ProviderError extends Schema.TaggedError<ProviderError>()("ProviderError", {
  reason: Schema.Literals([
    "AuthenticationFailed",
    "Unavailable",
    "Misconfigured",
    "UnknownProvider",
  ]),
  provider: Schema.String,
}) {}

/** A value did not match its schema. The error names the key and never holds the value. */
export declare class DecodeError extends Schema.TaggedError<DecodeError>()("DecodeError", {
  key: Schema.String,
}) {}

export declare class CacheError extends Schema.TaggedError<CacheError>()("CacheError", {
  reason: Schema.Literals([
    "Unreadable",
    "Unwritable",
    "Corrupt",
    "IntegrityFailed",
    "KeyUnavailable",
    "LockTimeout",
  ]),
}) {}

export type EnviError = ReferenceError | ProviderError | DecodeError | CacheError;

type Decoded<S> =
  S extends Source<infer A, infer O> ? (O extends true ? A | undefined : A) : string;

/**
 * The Effect service takes the config as an argument, because a service cannot carry a type
 * parameter. The plain client binds one config instead. Both have the same operations.
 */
export interface EnviService {
  readonly load: <C extends Config>(
    config: C,
    options?: LoadOptions<StageOf<C>>,
  ) => Effect.Effect<Env<C>, EnviError>;
  readonly loadRaw: <C extends Config>(
    config: C,
    options?: LoadOptions<StageOf<C>>,
  ) => Effect.Effect<RawEnv<C>, EnviError>;
  readonly parse: <C extends Config>(
    config: C,
    record: Readonly<Record<string, string | undefined>>,
    options?: { readonly stage?: StageOf<C> },
  ) => Effect.Effect<Env<C>, DecodeError>;
  readonly resolve: {
    <A, O extends boolean>(
      source: Source<A, O>,
      options?: ResolveOptions,
    ): Effect.Effect<Decoded<Source<A, O>>, EnviError>;
    <const R extends Readonly<Record<string, AnySource>>>(
      sources: R,
      options?: ResolveOptions,
    ): Effect.Effect<{ readonly [K in keyof R]: Decoded<R[K]> }, EnviError>;
  };

  readonly run: <C extends Config>(
    config: C,
    command: string,
    args?: ReadonlyArray<string>,
    options?: RunOptions<StageOf<C>>,
  ) => Effect.Effect<RunReport, EnviError>;
  /** One config or a list. A list gives one batch for each provider across all configs. */
  readonly sync: (
    configs: Config | ReadonlyArray<Config>,
    options?: LoadOptions<string>,
  ) => Effect.Effect<SyncReport, ProviderError | CacheError>;
  readonly check: <C extends Config>(
    config: C,
    options?: { readonly stage?: StageOf<C> },
  ) => Effect.Effect<CheckReport, ProviderError>;
  readonly inspect: <C extends Config>(
    config: C,
    options?: ExportOptions<StageOf<C>>,
  ) => Effect.Effect<InspectReport, EnviError>;
  readonly export: <C extends Config>(
    config: C,
    format: ExportFormat,
    options?: ExportOptions<StageOf<C>>,
  ) => Effect.Effect<string, EnviError>;
  readonly cache: {
    readonly path: Effect.Effect<string>;
    readonly list: Effect.Effect<CacheListReport, CacheError>;
    readonly clear: Effect.Effect<CacheClearReport, CacheError>;
  };
}

/** Unstable. The logical cache: values plus freshness. Encryption is private to the file layer. */
export declare class Cache extends Context.Service<
  Cache,
  {
    readonly getMany: (
      keys: ReadonlyArray<string>,
    ) => Effect.Effect<Readonly<Record<string, CacheRecord>>, CacheError>;
    readonly setMany: (
      records: Readonly<Record<string, CacheRecord>>,
    ) => Effect.Effect<void, CacheError>;
    readonly removeMany: (keys: ReadonlyArray<string>) => Effect.Effect<void, CacheError>;
    readonly clear: Effect.Effect<void, CacheError>;
    /** Runs one resolution at a time across processes. The memory and disabled layers run it directly. */
    readonly withResolveLock: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | CacheError, R>;
  }
>()("envi/Cache") {
  static readonly layerFileSystem: (options?: {
    readonly directory?: string;
    readonly encryption?: "keychain" | "none";
  }) => Layer.Layer<Cache, CacheError, FileSystem.FileSystem | Path.Path | ChildProcessSpawner>;
  static readonly layerMemory: Layer.Layer<Cache>;
  static readonly layerNone: Layer.Layer<Cache>;
}

/** Unstable. The interface can change until a second real provider proves it. */
export interface ProviderDefinition<Ref, Helpers extends object = {}> {
  readonly id: string;
  readonly Reference: Schema.Codec<Ref, unknown>;
  readonly describe: (ref: Ref) => string;
  readonly cacheKey: (ref: Ref) => string;
  readonly resolveMany: (
    requests: ReadonlyArray<ProviderRequest<Ref>>,
    context: ResolveContext,
  ) => Effect.Effect<
    Readonly<Record<string, Result.Result<string, ReferenceError>>>,
    ProviderError
  >;
  /** The descriptor helpers that `vars` receives, such as `{ vault }`. */
  readonly helpers?: Helpers;
}

export declare const Provider: {
  readonly make: <Ref, const Helpers extends object = {}>(
    definition: ProviderDefinition<Ref, Helpers>,
  ) => ProviderHandle<Helpers>;
};

export declare class Providers extends Context.Service<
  Providers,
  ReadonlyMap<string, ProviderHandle>
>()("envi/Providers") {
  /** Fails with `Misconfigured` if two providers share one id. */
  static readonly layer: (
    providers: ReadonlyArray<ProviderHandle>,
  ) => Layer.Layer<Providers, ProviderError>;
}

export declare class Envi extends Context.Service<Envi, EnviService>()("envi/Envi") {
  /** The default composition: the file cache with keychain encryption, and the given providers. */
  static readonly layer: (
    options?: EnviOptions,
  ) => Layer.Layer<
    Envi,
    CacheError | ProviderError,
    FileSystem.FileSystem | Path.Path | ChildProcessSpawner
  >;
  /** The bare core. The caller provides the cache and the providers. */
  static readonly layerCore: Layer.Layer<Envi, never, Cache | Providers>;
  /** Feeds Effect's own `Config` module from an Envi config. */
  static readonly layerConfigProvider: <C extends Config>(
    config: C,
    options?: LoadOptions<StageOf<C>>,
  ) => Layer.Layer<never, EnviError, Envi>;
}
