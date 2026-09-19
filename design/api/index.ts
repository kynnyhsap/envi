// Type-only sketch of the public core entry point. No implementation exists yet.
// The import name `envi` is an alias in `design/tsconfig.json`. The npm package name is not decided.
import type * as Duration from "effect/Duration";
import type * as Schema from "effect/Schema";

import type {
  CacheClearReport,
  CacheListReport,
  CheckReport,
  InspectReport,
  RunReport,
  SyncReport,
} from "./reports.ts";

export * from "./reports.ts";

declare const SourceTypeId: unique symbol;

/** A descriptor of one value. `A` is the decoded type. `Optional` tracks `.optional()`. */
export interface Source<out A = string, out Optional extends boolean = false> {
  readonly [SourceTypeId]: { readonly A: A; readonly Optional: Optional };
  /** Decodes the raw string. Envi accepts only an Effect `Schema` that encodes to a string. */
  readonly schema: <B>(schema: Schema.Codec<B, string>) => Source<B, Optional>;
  /** A reference that the provider reports as `NotFound` becomes `undefined`. No other failure does. */
  readonly optional: () => Source<A, true>;
  /** The raw fallback for a `NotFound` reference. The fallback passes through the schema. */
  readonly default: (raw: string) => Source<A, false>;
  readonly redact: (enabled?: boolean) => Source<A, Optional>;
  /** Overrides the cache settings for this one value. `false` resolves it on every load. */
  readonly cache: (settings: false | SourceCacheSettings) => Source<A, Optional>;
}

export interface SourceCacheSettings {
  readonly ttl?: Duration.Input;
  readonly maxStale?: Duration.Input;
}

export type AnySource = Source<unknown, boolean>;
export type Vars = Readonly<Record<string, string | AnySource>>;

type Decoded<S> =
  S extends Source<infer A, infer O> ? (O extends true ? A | undefined : A) : string;
type Raw<S> =
  S extends Source<unknown, infer O> ? (O extends true ? string | undefined : string) : string;

/** The helpers that every config gets, with or without a provider. */
export interface BuiltInHelpers {
  readonly value: typeof value;
  readonly custom: typeof custom;
  readonly fromEnv: typeof fromEnv;
  readonly reference: typeof reference;
}

type UnionToIntersection<U> = (U extends unknown ? (member: U) => void : never) extends (
  member: infer I,
) => void
  ? I
  : never;

type HelpersOfOne<P> = P extends Provider<infer Helpers> ? Helpers : never;

/** The descriptor helpers of a provider list, such as `{ op }` for the 1Password provider. */
export type HelpersOf<P extends ReadonlyArray<Provider>> = UnionToIntersection<
  HelpersOfOne<P[number]>
>;

/** The parameter of `vars`: the stage, the built-in helpers, and the helpers of each provider. */
export type VarsContext<Stage extends string, P extends ReadonlyArray<Provider>> = {
  readonly stage: Stage;
} & BuiltInHelpers &
  HelpersOf<P>;

export interface CacheSettings {
  readonly directory?: string;
  /** The refresh interval. Default: 24 hours. */
  readonly ttl?: Duration.Input;
  /** The longest time that Envi can use an expired entry after a transient failure. Default: 7 days. */
  readonly maxStale?: Duration.Input;
}

export interface ConfigInput<
  Stage extends string,
  P extends ReadonlyArray<Provider>,
  V extends Vars,
> {
  readonly stages?: ReadonlyArray<Stage>;
  readonly defaultStage?: NoInfer<Stage>;
  /** The CLI uses these providers. An SDK client uses them unless it gets its own providers. */
  readonly providers?: P;
  readonly cache?: false | CacheSettings;
  readonly strict?: boolean;
  /**
   * A plain object, or a synchronous function of the stage. It never resolves a secret.
   * A config without `vars` serves a client that only calls `resolve`.
   */
  readonly vars?: V | ((context: VarsContext<Stage, P>) => V);
}

declare const ConfigTypeId: unique symbol;

export interface Config<Stage extends string = string, V extends Vars = Vars> {
  readonly [ConfigTypeId]: { readonly Stage: Stage; readonly Vars: V };
}

export type Env<C> =
  C extends Config<string, infer V> ? { readonly [K in keyof V]: Decoded<V[K]> } : never;
export type RawEnv<C> =
  C extends Config<string, infer V> ? { readonly [K in keyof V]: Raw<V[K]> } : never;
export type StageOf<C> = C extends Config<infer S, Vars> ? S : never;

export declare const defineConfig: <
  const Stage extends string = string,
  const P extends ReadonlyArray<Provider> = readonly [],
  const V extends Vars = {},
>(
  input: ConfigInput<Stage, P, V>,
) => Config<Stage, V>;

/** A literal value. A plain string in `vars` means the same as `value(string)`. */
export declare const value: (raw: string) => Source<string>;

/** A descriptor for any provider. A provider package builds its own helper on top of this. */
export declare const reference: <Ref>(providerId: string, ref: Ref) => Source<string>;

/**
 * A value from user code. It replaces an effectful config: `vars` stays synchronous, and `resolve`
 * runs later, in the batch. It belongs to the built-in provider with the id `custom`.
 * With a `key`, Envi caches the value under that key. Without a `key`, Envi never caches it.
 */
export declare const custom: (definition: {
  readonly key?: string;
  readonly resolve: () => string | Promise<string>;
}) => Source<string>;

/**
 * A value from the environment of the Envi process, such as a CI secret. Envi never caches it.
 * A missing variable counts as `NotFound`, so `.optional()` and `.default()` apply.
 */
export declare const fromEnv: (name: string) => Source<string>;

/** The schema of a config for one stage. `vars` is synchronous, so this needs no I/O. */
export declare const schemaOf: <C extends Config>(
  config: C,
  options?: { readonly stage?: StageOf<C> },
) => Schema.Codec<Env<C>, RawEnv<C>>;

// --- cache -------------------------------------------------------------------------------------

/** The logical cache record. Encryption is private to the file cache and never appears here. */
export interface CacheRecord {
  readonly provider: string;
  /** The `describe()` text. `cache list` shows it. */
  readonly reference: string;
  readonly value: string;
  readonly resolvedAt: string;
}

/** Unstable. The interface can change until a second real cache proves it. */
export interface CacheStore {
  readonly getMany: (keys: ReadonlyArray<string>) => Promise<Readonly<Record<string, CacheRecord>>>;
  readonly setMany: (records: Readonly<Record<string, CacheRecord>>) => Promise<void>;
  readonly removeMany: (keys: ReadonlyArray<string>) => Promise<void>;
  readonly clear: () => Promise<void>;
}

export declare const CacheEncryption: {
  readonly Keychain: "keychain";
  readonly None: "none";
};

export type CacheEncryption = (typeof CacheEncryption)[keyof typeof CacheEncryption];

export declare const fileCache: (options?: {
  readonly directory?: string;
  /** Default: `Keychain` on macOS. Envi never falls back to `None` on its own. */
  readonly encryption?: CacheEncryption;
}) => CacheStore;

export declare const memoryCache: () => CacheStore;

// --- providers ---------------------------------------------------------------------------------

export declare const ReferenceFailure: {
  readonly NotFound: "NotFound";
  readonly Invalid: "Invalid";
  readonly AccessDenied: "AccessDenied";
};

export type ReferenceFailure = (typeof ReferenceFailure)[keyof typeof ReferenceFailure];

export type ReferenceResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: ReferenceFailure };

export interface ProviderRequest<Ref> {
  /** The cache key of the reference. The provider returns each result under this key. */
  readonly key: string;
  readonly reference: Ref;
}

export interface ResolveContext {
  /** `false` in CI. A provider must not open a prompt or use desktop authentication then. */
  readonly interactive: boolean;
}

declare const ProviderTypeId: unique symbol;

/** An opaque provider handle. `defineProvider` and the provider packages create it. */
export interface Provider<out Helpers extends object = object> {
  readonly [ProviderTypeId]: { readonly Helpers: Helpers };
  readonly id: string;
}

/** Unstable. The interface can change until a second real provider proves it. */
export declare const defineProvider: <Ref, const Helpers extends object = {}>(definition: {
  readonly id: string;
  readonly Reference: Schema.Codec<Ref, unknown>;
  /** Text for `print`, `check`, `sync`, `cache list`, errors, and debug logs. It holds no secret. */
  readonly describe: (ref: Ref) => string;
  /** Every part that decides where the value comes from: account, credential kind, reference. */
  readonly cacheKey: (ref: Ref) => string;
  /** Results are matched by `key`, not by position. Envi rejects a missing or an unknown key. */
  readonly resolveMany: (
    requests: ReadonlyArray<ProviderRequest<Ref>>,
    context: ResolveContext,
  ) => Promise<Readonly<Record<string, ReferenceResult>>>;
  /** The descriptor helpers that `vars` receives, such as `{ aws }`. */
  readonly helpers?: Helpers;
}) => Provider<Helpers>;

// --- client ------------------------------------------------------------------------------------

export interface EnviOptions {
  /** Replaces the providers of the config. Tests pass an in-memory provider here. */
  readonly providers?: ReadonlyArray<Provider>;
  readonly cache?: false | CacheSettings | CacheStore;
  readonly strict?: boolean;
}

export interface ResolveOptions {
  readonly refresh?: boolean;
  readonly strict?: boolean;
}

export interface LoadOptions<Stage extends string> extends ResolveOptions {
  readonly stage?: Stage;
}

/** The export formats. Code refers to a format through this object, not through a string literal. */
export declare const ExportFormat: {
  readonly Dotenv: "dotenv";
  readonly Json: "json";
};

export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];

/** The schema of `ExportFormat`. The CLI decodes `--format` with it. */
export declare const ExportFormatSchema: Schema.Codec<ExportFormat, string>;

export interface Resolve {
  <A, O extends boolean>(
    source: Source<A, O>,
    options?: ResolveOptions,
  ): Promise<Decoded<Source<A, O>>>;
  <const R extends Readonly<Record<string, AnySource>>>(
    sources: R,
    options?: ResolveOptions,
  ): Promise<{ readonly [K in keyof R]: Decoded<R[K]> }>;
}

export interface ExportOptions<Stage extends string> extends LoadOptions<Stage> {
  readonly redact?: boolean;
}

export interface RunOptions<Stage extends string> extends LoadOptions<Stage> {
  readonly cwd?: string;
}

declare const EnviTypeId: unique symbol;

/** Any client, without its config type. `syncAll` takes a list of these. */
export interface AnyEnvi {
  readonly [EnviTypeId]: typeof EnviTypeId;
}

/** The client. It has one method for each CLI command, plus the SDK-only operations. */
export interface Envi<C extends Config> extends AnyEnvi {
  /** Resolves the config through the cache and the providers. Returns decoded values. */
  readonly load: (options?: LoadOptions<StageOf<C>>) => Promise<Env<C>>;
  /** The same resolution. Returns the raw strings, as `run` injects them. */
  readonly loadRaw: (options?: LoadOptions<StageOf<C>>) => Promise<RawEnv<C>>;
  /** Decodes strings that already exist. Calls no provider and reads no cache. */
  readonly parse: (
    record: Readonly<Record<string, string | undefined>>,
    options?: { readonly stage?: StageOf<C> },
  ) => Env<C>;
  /** Resolves one source, or one record of sources in one batch, with the providers of the config. */
  readonly resolve: Resolve;

  /** `envi run`. Resolves all vars, starts the child, forwards signals, returns the exit code. */
  readonly run: (
    command: string,
    args?: ReadonlyArray<string>,
    options?: RunOptions<StageOf<C>>,
  ) => Promise<RunReport>;
  /** `envi sync`. Fills the cache. A failed var appears in the report and does not reject. */
  readonly sync: (options?: LoadOptions<StageOf<C>>) => Promise<SyncReport>;
  /** `envi check`. Resolves from the provider, ignores the cache, and never returns a value. */
  readonly check: (options?: { readonly stage?: StageOf<C> }) => Promise<CheckReport>;
  /** `envi inspect`. Redacts by default. `redact: false` reveals the values. */
  readonly inspect: (options?: ExportOptions<StageOf<C>>) => Promise<InspectReport>;
  /** `envi export`. Renders the real values. `redact: true` hides the secret values. */
  readonly export: (format: ExportFormat, options?: ExportOptions<StageOf<C>>) => Promise<string>;
  /** `envi cache path`, `envi cache list`, and `envi cache clear`. */
  readonly cache: {
    readonly path: () => string;
    readonly list: () => Promise<CacheListReport>;
    readonly clear: () => Promise<CacheClearReport>;
  };
}

/** The only entry to the SDK. `overrides` wins over the config. Tests pass providers here. */
export declare const createEnvi: <C extends Config>(config: C, overrides?: EnviOptions) => Envi<C>;

/** `envi sync` for a monorepo: one batch for each provider across all clients. */
export declare const syncAll: (
  clients: ReadonlyArray<AnyEnvi>,
  options?: LoadOptions<string>,
) => Promise<SyncReport>;
