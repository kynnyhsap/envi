import * as Data from "effect/Data";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { DecodeError, ProviderError, ProviderFailure } from "./Errors.ts";

/**
 * The brand of a descriptor. It is a registered symbol, so a descriptor from a second copy of this
 * module still passes `isSource`.
 */
export const TypeId: unique symbol = Symbol.for("envi/Source");

/** The id of the built-in provider that owns every `custom()` value. */
export const customProviderId = "custom";

/**
 * Gives the decoded value of one input of a `custom()` value. The resolver of Envi implements it.
 *
 * @template E - The failures of the resolver. `custom()` passes them through unchanged.
 */
export interface InputResolver<E> {
  <A, Optional extends boolean>(
    source: Source<A, Optional>,
  ): Effect.Effect<Decoded<Source<A, Optional>>, E>;
}

/** Where the raw string of a descriptor comes from. */
export type Origin = Data.TaggedEnum<{
  /** A string in the config file. */
  Literal: { readonly value: string };
  /** A variable in the environment of the Envi process. */
  Environment: { readonly name: string };
  /** A reference that a provider resolves. The provider decodes `reference`. */
  Reference: { readonly provider: string; readonly reference: Schema.Json };
  /** A value from user code. `run` never puts the cause of a failure into its error. */
  Custom: {
    readonly key: Option.Option<string>;
    /** The inputs. Envi collects their references before it resolves the batch. */
    readonly inputs: ReadonlyArray<AnySource>;
    /** Resolves the inputs through `resolveInput`, and then calls the user function. */
    readonly run: <E>(resolveInput: InputResolver<E>) => Effect.Effect<string, ProviderError | E>;
  };
}>;

/** The constructors and the matcher of `Origin`. */
export const Origin = Data.taggedEnum<Origin>();

/** The cache settings that one descriptor overrides. */
export interface CacheOverride {
  readonly ttl?: Duration.Input;
  readonly maxStale?: Duration.Input;
}

/** How one descriptor uses the cache. */
export type CachePolicy = Data.TaggedEnum<{
  /** The descriptor uses the cache settings of the config. */
  Inherit: {};
  /** Envi resolves the value on every load. */
  Disabled: {};
  /** The descriptor has its own freshness settings. */
  Override: {
    readonly ttl: Option.Option<Duration.Input>;
    readonly maxStale: Option.Option<Duration.Input>;
  };
}>;

/** The constructors and the matcher of `CachePolicy`. */
export const CachePolicy = Data.taggedEnum<CachePolicy>();

/**
 * A descriptor of one value. It holds no resolved value and does no I/O.
 *
 * @template A - The decoded type.
 * @template Optional - `true` after `.optional()`. The decoded type then includes `undefined`.
 */
export interface Source<out A = string, out Optional extends boolean = false> {
  readonly [TypeId]: typeof TypeId;
  readonly origin: Origin;
  readonly codec: Schema.Codec<A, string>;
  readonly isOptional: Optional;
  /** The raw fallback for a reference that the provider reports as `NotFound`. */
  readonly fallback: Option.Option<string>;
  readonly isRedacted: boolean;
  readonly cachePolicy: CachePolicy;
  /** Decodes the raw string. Envi accepts only a schema that encodes to a string. */
  readonly schema: <B>(codec: Schema.Codec<B, string>) => Source<B, Optional>;
  /** A `NotFound` reference becomes `undefined`. Every other failure stays a failure. */
  readonly optional: () => Source<A, true>;
  /** A `NotFound` reference becomes this raw string. The string passes through the schema. */
  readonly default: (raw: string) => Source<A>;
  /** Shows or hides the value in `inspect` and in a redacted export. */
  readonly redact: (enabled?: boolean) => Source<A, Optional>;
  /** `false` resolves the value on every load. An object overrides the freshness settings. */
  readonly cache: (settings: false | CacheOverride) => Source<A, Optional>;
}

/** Any descriptor, without its decoded type. */
export type AnySource = Source<unknown, boolean>;

/** The decoded type of a descriptor, or `string` for a plain string in `vars`. */
export type Decoded<S> =
  S extends Source<infer A, infer Optional> ? (Optional extends true ? A | undefined : A) : string;

/** The raw type of a descriptor: a string, or `undefined` for an optional one. */
export type Raw<S> =
  S extends Source<unknown, infer Optional>
    ? Optional extends true
      ? string | undefined
      : string
    : string;

interface State<A, Optional extends boolean> {
  readonly origin: Origin;
  readonly codec: Schema.Codec<A, string>;
  readonly isOptional: Optional;
  readonly fallback: Option.Option<string>;
  readonly isRedacted: boolean;
  readonly cachePolicy: CachePolicy;
}

const make = <A, Optional extends boolean>(state: State<A, Optional>): Source<A, Optional> => ({
  [TypeId]: TypeId,
  ...state,
  schema: (codec) => make({ ...state, codec }),
  optional: () => make({ ...state, isOptional: true, fallback: Option.none() }),
  default: (raw) => make({ ...state, isOptional: false, fallback: Option.some(raw) }),
  redact: (enabled = true) => make({ ...state, isRedacted: enabled }),
  cache: (settings) =>
    make({
      ...state,
      cachePolicy:
        settings === false
          ? CachePolicy.Disabled()
          : CachePolicy.Override({
              ttl: Option.fromUndefinedOr(settings.ttl),
              maxStale: Option.fromUndefinedOr(settings.maxStale),
            }),
    }),
});

const fromOrigin = (origin: Origin, isRedacted: boolean): Source =>
  make({
    origin,
    codec: Schema.String,
    isOptional: false,
    fallback: Option.none(),
    isRedacted,
    cachePolicy: CachePolicy.Inherit(),
  });

/** Tells whether a value is a descriptor, also when another copy of this module built it. */
export const isSource = (input: unknown): input is AnySource =>
  Predicate.hasProperty(input, TypeId);

/** A literal value. A plain string in `vars` means the same. Envi does not redact it by default. */
export const value = (raw: string): Source => fromOrigin(Origin.Literal({ value: raw }), false);

/**
 * A value from the environment of the Envi process, such as a CI secret. Envi never caches it.
 * A missing variable counts as `NotFound`, so `.optional()` and `.default()` apply.
 */
export const fromEnv = (name: string): Source => fromOrigin(Origin.Environment({ name }), true);

/**
 * A descriptor for any provider. A provider package builds its own helper on top of this.
 *
 * @param provider - The id of the provider that resolves the reference.
 * @param ref - The reference as JSON data. The provider decodes it with its `Reference` schema.
 */
export const reference = (provider: string, ref: Schema.Json): Source =>
  fromOrigin(Origin.Reference({ provider, reference: ref }), true);

/** The decoded inputs of one `custom()` value, keyed by the names in `from`. */
export type CustomInputsOf<From extends Readonly<Record<string, AnySource>>> = {
  readonly [K in keyof From]: Decoded<From[K]>;
};

/** The definition of one `custom()` value. */
export interface CustomDefinition<From extends Readonly<Record<string, AnySource>>> {
  /** With a key, Envi caches the result under this key. Without a key, Envi never caches it. */
  readonly key?: string;
  /** The inputs. Envi resolves them in the batch and passes the decoded values to `resolve`. */
  readonly from?: From;
  readonly resolve: (
    inputs: CustomInputsOf<From>,
  ) => string | PromiseLike<string> | Effect.Effect<string, unknown>;
}

const customFailure = (key: Option.Option<string>): ProviderError =>
  new ProviderError({
    reason: ProviderFailure.Unavailable,
    provider: customProviderId,
    detail: Option.match(key, {
      onNone: () => "A custom() value without a key failed to resolve.",
      onSome: (known) => `The custom() value with the key "${known}" failed to resolve.`,
    }),
  });

/**
 * A value from user code. It is the only primitive for custom and derived values. `resolve` runs
 * after the batch, never inside `vars`. A throw, a rejection, and a failed `Effect` all become a
 * `ProviderError` that holds the key and never the cause, because a cause can hold a secret.
 */
export const custom = <const From extends Readonly<Record<string, AnySource>> = {}>(
  definition: CustomDefinition<From>,
): Source => {
  const key = Option.fromUndefinedOr(definition.key);

  const from: Readonly<Record<string, AnySource>> = definition.from ?? {};

  const callResolve = (inputs: CustomInputsOf<From>): Effect.Effect<string, ProviderError> =>
    Effect.suspend(() => {
      const result = definition.resolve(inputs);

      if (Effect.isEffect(result)) {
        return result;
      }

      return Predicate.isPromiseLike(result)
        ? Effect.tryPromise(() => Promise.resolve(result))
        : Effect.succeed(result);
    }).pipe(
      Effect.catchDefect(() => Effect.fail(customFailure(key))),
      Effect.mapError(() => customFailure(key)),
    );

  const run = <E>(resolveInput: InputResolver<E>): Effect.Effect<string, ProviderError | E> =>
    Effect.forEach(Object.entries(from), ([name, source]) =>
      Effect.map(resolveInput(source), (decoded) => [name, decoded] as const),
    ).pipe(
      Effect.flatMap((entries) =>
        // SAFETY: TypeScript cannot relate the entries to the mapped type. Each entry comes from
        // one key of `from`, and `resolveInput` returns the decoded value of that descriptor.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        callResolve(Object.fromEntries(entries) as CustomInputsOf<From>),
      ),
    );

  return fromOrigin(Origin.Custom({ key, inputs: Object.values(from), run }), true);
};

const decodeFailure = (key: string, codec: Schema.Top): DecodeError =>
  new DecodeError({ key, expected: String(codec.ast) });

/**
 * Decodes one raw string with the schema of its descriptor.
 *
 * @param key - The var name. The error holds it instead of the rejected value.
 * @returns The decoded value, or a `DecodeError` that never holds the raw string.
 */
export const decode = <A, Optional extends boolean>(
  source: Source<A, Optional>,
  key: string,
  raw: string,
): Effect.Effect<A, DecodeError> =>
  Schema.decodeEffect(source.codec)(raw).pipe(
    // The schema message can quote the rejected value, so only a var that is not redacted shows it.
    Effect.tapError((issue) =>
      Effect.logDebug("Envi rejected a value that does not fit its schema.").pipe(
        Effect.annotateLogs({
          key,
          schema: source.isRedacted ? "hidden, because the var is redacted" : String(issue),
        }),
      ),
    ),
    Effect.mapError(() => decodeFailure(key, source.codec)),
  );
