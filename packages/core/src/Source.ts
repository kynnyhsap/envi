import * as Data from "effect/Data";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

import { CustomError, CustomFailure, CustomReason, DecodeError, DeriveError } from "./Errors.ts";
import * as Thrown from "./Thrown.ts";

/**
 * The brand of a descriptor. It is a registered symbol, so a descriptor from a second copy of this
 * module still passes `isSource`.
 */
export const TypeId: unique symbol = Symbol.for("envi/Source");

/** The id under which `custom()` values appear in the cache, reports, and errors. */
export const customProviderId = "custom";

/** The id under which `derive()` values appear in reports and errors. */
export const deriveProviderId = "derive";

/**
 * The decoded inputs of a `derive()` or `custom()` value, keyed by input name. Each value has the
 * type of its own schema, so only the overloads of `derive` and `InputsOf` can type it.
 */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
export type DecodedInputs = Readonly<Record<string, unknown>>;

/**
 * Calls user code with the decoded inputs. `None` means that the value is missing, so
 * `.optional()` and `.default()` apply.
 */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type
export type Call<E> = (inputs: DecodedInputs) => Effect.Effect<Option.Option<string>, E>;

/** Where the raw string of a descriptor comes from. */
export type Origin = Data.TaggedEnum<{
  /** A string in the config file. */
  Literal: { readonly value: string };
  /** A variable in the environment of the Envi process. */
  Environment: { readonly name: string };
  /** A reference that a provider resolves. The provider decodes `reference`. */
  Reference: { readonly provider: string; readonly reference: Schema.Json };
  /** A pure function of other values. Envi never caches it. */
  Derived: {
    readonly inputs: Readonly<Record<string, AnySource>>;
    readonly call: Call<DeriveError>;
  };
  /** A value from user code. Envi caches it for the inputs that produced it. */
  Custom: {
    readonly id: string;
    /** Everything outside the inputs that selects the value, such as a host. */
    readonly scope: string;
    /** The source text of `resolve`. An edit of the code invalidates the cache entry. */
    readonly code: string;
    readonly inputs: Readonly<Record<string, AnySource>>;
    readonly call: Call<CustomError>;
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

/** The decoded inputs of a `derive()` or `custom()` value, keyed by input name. */
export type InputsOf<From extends Readonly<Record<string, AnySource>>> = {
  readonly [K in keyof From]: Decoded<From[K]>;
};

const isCustomFailure = Schema.is(CustomFailure);

/** The input name of a `derive()` with one input. */
const singleInput = "value";

/**
 * A pure, synchronous function of other values, such as a URL built from its parts. Envi resolves
 * the inputs in the batch and never caches the result, so `.cache()` has no effect on it.
 * `undefined` counts as a missing value, so `.optional()` and `.default()` apply. A throw becomes
 * a `DeriveError` with the class name and the location, never the message.
 */
export function derive<const S extends AnySource>(
  input: S,
  fn: (value: Decoded<S>) => string | undefined,
): Source;
export function derive<const From extends Readonly<Record<string, AnySource>>>(
  inputs: From,
  fn: (inputs: InputsOf<From>) => string | undefined,
): Source;
export function derive<A>(
  input: AnySource | Readonly<Record<string, AnySource>>,
  fn: (value: A) => string | undefined,
): Source {
  const isSingle = TypeId in input;
  const inputs: Readonly<Record<string, AnySource>> = isSingle ? { [singleInput]: input } : input;

  const call: Call<DeriveError> = (decoded) =>
    Effect.map(
      Effect.try({
        try: () => {
          // SAFETY: TypeScript cannot relate the overloads to one implementation. The resolver
          // passes the decoded value of each input, which is what the overload of `fn` accepts.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          const argument = (isSingle ? decoded[singleInput] : decoded) as A;

          return fn(argument);
        },
        catch: (thrown) => new DeriveError(Thrown.describe(Thrown.asError(thrown))),
      }),
      Option.fromUndefinedOr,
    );

  return fromOrigin(Origin.Derived({ inputs, call }), true);
}

/** What `resolve` of a `custom()` value returns. `undefined` counts as a missing value. */
export type CustomResult = string | undefined;

/** The definition of one `custom()` value. */
export interface CustomDefinition<From extends Readonly<Record<string, AnySource>>> {
  /** Names the value in the cache and in errors. Use one id for one value in a project. */
  readonly id: string;
  /** The inputs. Envi resolves them in the batch and passes the decoded values to `resolve`. */
  readonly from?: From;
  /** Everything outside the inputs that selects the value, such as a host. Default: none. */
  readonly scope?: string;
  readonly resolve: (
    inputs: InputsOf<From>,
  ) => CustomResult | PromiseLike<CustomResult> | Effect.Effect<CustomResult, unknown>;
}

/**
 * A value from user code, such as a token exchange. `resolve` runs after the batch, never inside
 * `vars`. Envi caches the result for the stage, the scope, the code of `resolve`, and the values
 * of the inputs, so a rotated input computes a new value. A throw, a rejection, and a failed
 * `Effect` all become a `CustomError` that hides the message, unless the error is a
 * `CustomFailure`.
 */
export const custom = <const From extends Readonly<Record<string, AnySource>> = {}>(
  definition: CustomDefinition<From>,
): Source => {
  const { id } = definition;
  const inputs: Readonly<Record<string, AnySource>> = definition.from ?? {};

  const call: Call<CustomError> = (decoded) =>
    Effect.suspend(() => {
      // SAFETY: TypeScript cannot relate the record to the mapped type. The resolver passes the
      // decoded value of each input under its name in `from`.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const result = definition.resolve(decoded as InputsOf<From>);

      if (Effect.isEffect(result)) {
        return result;
      }

      return Predicate.isPromiseLike(result)
        ? Effect.tryPromise({ try: () => Promise.resolve(result), catch: (cause) => cause })
        : Effect.succeed(result);
    }).pipe(
      Effect.catchDefect((cause) => Effect.fail(cause)),
      Effect.mapError((cause) =>
        isCustomFailure(cause)
          ? new CustomError({
              reason: CustomReason.Failed,
              id,
              detail: cause.message,
              transient: cause.transient ?? false,
            })
          : new CustomError({
              reason: CustomReason.Threw,
              id,
              ...Thrown.describe(Thrown.asError(cause)),
              transient: false,
            }),
      ),
      Effect.map(Option.fromUndefinedOr),
    );

  return fromOrigin(
    Origin.Custom({
      id,
      scope: definition.scope ?? "",
      code: definition.resolve.toString(),
      inputs,
      call,
    }),
    true,
  );
};

const formatIssue = SchemaIssue.makeFormatterDefault();

/**
 * The expected type from a schema issue, such as "a finite number". The default formatter reports
 * no input, so the text never holds the rejected value.
 */
const expectedOf = (issue: SchemaIssue.Issue): string =>
  formatIssue(issue)
    .split("\n")
    .map((line) => line.trim().replace(/^Expected /u, ""))
    .join(" ");

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
    Effect.mapError((error) => new DecodeError({ key, expected: expectedOf(error.issue) })),
  );
