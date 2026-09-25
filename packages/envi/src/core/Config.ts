import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { ConfigLoadError, ConfigLoadFailure, UnknownStageError } from "./Errors.ts";
import type { Provider } from "./Provider.ts";
import * as Source from "./Source.ts";
import * as Thrown from "./Thrown.ts";

/** The brand of a config. It is a registered symbol, so a second copy of this module agrees. */
export const TypeId: unique symbol = Symbol.for("envi/Config");

/** The stage that Envi uses when nothing selects one. */
export const fallbackStage = "development";

/** The cache settings of a config. */
export interface CacheSettings {
  readonly directory?: string;
  /** `"none"` writes plaintext files with the mode `0600`. Envi never selects it on its own. */
  readonly encryption?: "keychain" | "none";
  /** The refresh interval. Default: 24 hours. */
  readonly ttl?: Duration.Input;
  /** The longest time that Envi uses an expired entry after a transient failure. Default: 7 days. */
  readonly maxStale?: Duration.Input;
}

/** The values of `vars`: a plain string is a literal, and everything else is a descriptor. */
export type Vars = Readonly<Record<string, string | Source.AnySource>>;

/** The helpers that every config gets, with or without a provider. */
export interface BuiltInHelpers {
  readonly value: typeof Source.value;
  readonly derive: typeof Source.derive;
  readonly custom: typeof Source.custom;
  readonly fromEnv: typeof Source.fromEnv;
  readonly reference: typeof Source.reference;
}

type UnionToIntersection<U> = (U extends unknown ? (member: U) => void : never) extends (
  member: infer I,
) => void
  ? I
  : never;

type HelpersOfOne<P> = P extends Provider<infer Helpers> ? Helpers : never;

/** The descriptor helpers of a provider list, such as `{ mem }` for the in-memory provider. */
export type HelpersOf<P extends ReadonlyArray<Provider>> = UnionToIntersection<
  HelpersOfOne<P[number]>
>;

/** The parameter of `vars`: the stage, the built-in helpers, and the helpers of each provider. */
export type VarsContext<Stage extends string, P extends ReadonlyArray<Provider>> = {
  readonly stage: Stage;
} & BuiltInHelpers &
  HelpersOf<P>;

/** What a user passes to `defineConfig`. */
export interface Input<Stage extends string, P extends ReadonlyArray<Provider>, V extends Vars> {
  /** Gives `stage` a union type. Envi rejects any other stage. Without it, a stage is any string. */
  readonly stages?: ReadonlyArray<Stage>;
  readonly defaultStage?: NoInfer<Stage>;
  readonly providers?: P;
  readonly cache?: false | CacheSettings;
  readonly strict?: boolean;
  /**
   * A plain object, or a synchronous function of the stage. It never resolves a secret.
   * A config without `vars` serves a client that only calls `resolve`.
   */
  readonly vars?: V | ((context: VarsContext<Stage, P>) => V);
}

/**
 * A config. It is inspectable data: reading it calls no provider.
 *
 * @template Stage - The stage union from `stages`, or `string`.
 * @template V - The record that `vars` returns.
 */
export interface Config<out Stage extends string = string, out V extends Vars = Vars> {
  readonly [TypeId]: typeof TypeId;
  /** Carries the type parameters for inference. No code sets or reads it. */
  readonly types?: { readonly Stage: Stage; readonly Vars: V };
  /** The declared stages. An empty list means that a stage is any string. */
  readonly stages: ReadonlyArray<string>;
  readonly defaultStage: Option.Option<string>;
  readonly providers: ReadonlyArray<Provider>;
  readonly cache: Option.Option<false | CacheSettings>;
  readonly strict: Option.Option<boolean>;
  /** The config file. The loader sets it. A config from `defineConfig` in code has none. */
  readonly path: Option.Option<string>;
  /** Evaluates `vars` for one stage. It throws what `vars` throws. */
  readonly evaluate: (stage: string) => Vars;
}

/** The decoded env of a config. */
export type Env<C> =
  C extends Config<string, infer V> ? { readonly [K in keyof V]: Source.Decoded<V[K]> } : never;

/** The raw env of a config, as `envi run` injects it. */
export type RawEnv<C> =
  C extends Config<string, infer V> ? { readonly [K in keyof V]: Source.Raw<V[K]> } : never;

/** The stage type of a config. */
export type StageOf<C> = C extends Config<infer Stage> ? Stage : never;

/**
 * Defines a config. `vars` runs later, once for each stage that Envi needs.
 *
 * @returns A config whose types carry the stage union and the var record.
 */
export const defineConfig = <
  const Stage extends string = string,
  const P extends ReadonlyArray<Provider> = readonly [],
  const V extends Vars = {},
>(
  input: Input<Stage, P, V>,
): Config<Stage, V> => {
  const providers: ReadonlyArray<Provider> = input.providers ?? [];
  const vars = input.vars;

  const evaluate = (stage: string): Vars => {
    if (vars === undefined) {
      return {};
    }

    if (!Predicate.isFunction(vars)) {
      return vars;
    }

    const providerHelpers = {};

    for (const provider of providers) {
      Object.assign(providerHelpers, provider.helpers);
    }

    const context = {
      ...providerHelpers,
      stage,
      value: Source.value,
      derive: Source.derive,
      custom: Source.custom,
      fromEnv: Source.fromEnv,
      reference: Source.reference,
    };

    // SAFETY: TypeScript cannot build the intersection of the helper records. `selectStage`
    // checked `stage` against `stages`, and each provider supplies exactly its own helpers.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return vars(context as VarsContext<Stage, P>);
  };

  return {
    [TypeId]: TypeId,
    stages: input.stages ?? [],
    defaultStage: Option.fromUndefinedOr(input.defaultStage),
    providers,
    cache: Option.fromUndefinedOr(input.cache),
    strict: Option.fromUndefinedOr(input.strict),
    path: Option.none(),
    evaluate,
  };
};

/** Tells whether a value is a config, also when another copy of this module built it. */
export const isConfig = (input: unknown): input is Config => Predicate.hasProperty(input, TypeId);

/**
 * Selects the stage of one operation: the requested stage, then `defaultStage`, then
 * `"development"`. The caller puts `--stage` and `ENVI_STAGE` into `requested`.
 *
 * @returns The stage, or `UnknownStageError` when the config declares stages and this is not one.
 */
export const selectStage = (
  config: Config,
  requested: Option.Option<string>,
): Effect.Effect<string, UnknownStageError> => {
  const stage = requested.pipe(
    Option.orElse(() => config.defaultStage),
    Option.getOrElse(() => fallbackStage),
  );

  return config.stages.length === 0 || config.stages.includes(stage)
    ? Effect.succeed(stage)
    : Effect.fail(new UnknownStageError({ stage, stages: config.stages }));
};

/** The descriptors of evaluated vars. A plain string becomes a literal descriptor. */
const sourcesOf = (vars: Vars): Readonly<Record<string, Source.AnySource>> =>
  Object.fromEntries(
    Object.entries(vars).map(([key, entry]) => [
      key,
      Predicate.isString(entry) ? Source.value(entry) : entry,
    ]),
  );

/** The names that `vars` receives besides the helpers of the providers. */
const builtInNames: ReadonlyArray<string> = [
  "stage",
  "value",
  "derive",
  "custom",
  "fromEnv",
  "reference",
];

/** The first helper name that two providers, or a provider and a built-in, both define. */
const duplicateHelperOf = (config: Config): Option.Option<string> => {
  const names = [...builtInNames, ...config.providers.flatMap((p) => Object.keys(p.helpers))];

  return Option.fromUndefinedOr(names.find((name, index) => names.indexOf(name) !== index));
};

/**
 * The descriptors of a config for one stage.
 *
 * @returns The descriptors. `InvalidConfig` when two providers define one helper name. `VarsThrew`
 * with the class name and the location of a throw.
 */
export const varsFor = (
  config: Config,
  stage: string,
): Effect.Effect<Readonly<Record<string, Source.AnySource>>, ConfigLoadError> => {
  const duplicate = duplicateHelperOf(config);

  if (Option.isSome(duplicate)) {
    return Effect.fail(
      new ConfigLoadError({
        reason: ConfigLoadFailure.InvalidConfig,
        path: Option.getOrElse(config.path, () => "defineConfig()"),
        detail: `Two sources define the helper \`${duplicate.value}\`. Each helper name of \`vars\` must be unique across the providers and the built-in helpers.`,
      }),
    );
  }

  return Effect.map(
    Effect.try({
      try: () => config.evaluate(stage),
      catch: (thrown) => {
        const described = Thrown.describe(Thrown.asError(thrown));

        return new ConfigLoadError({
          reason: ConfigLoadFailure.VarsThrew,
          path: Option.getOrElse(config.path, () => "defineConfig()"),
          detail: `\`vars\` threw ${described.thrown} for the stage ${stage}. Envi hides the error message, because it can hold a secret.`,
          location: described.location,
        });
      },
    }),
    sourcesOf,
  );
};

/** The var record of a config. */
export type VarsOf<C> = C extends Config<string, infer V> ? V : never;

/** The struct fields of a var record: the codec of each descriptor, optional where it is. */
export type FieldsOf<V extends Vars> = {
  readonly [K in keyof V]: V[K] extends Source.Source<infer A, infer Optional>
    ? Optional extends true
      ? Schema.optional<Schema.Codec<A, string>>
      : Schema.Codec<A, string>
    : Schema.String;
};

/**
 * The schema of a config for one stage. It needs no I/O, because `vars` is synchronous. An
 * optional var is an optional key of the struct.
 *
 * @param stage - A stage that `selectStage` accepted.
 */
export const schemaOf = <C extends Config>(
  config: C,
  stage: StageOf<C>,
): Schema.Struct<FieldsOf<VarsOf<C>>> => {
  const fields = Object.fromEntries(
    Object.entries(sourcesOf(config.evaluate(stage))).map(([key, source]) => [
      key,
      source.isOptional ? Schema.optional(source.codec) : source.codec,
    ]),
  );

  // SAFETY: TypeScript cannot relate the dynamic record to the mapped type. Each field is the
  // codec of the descriptor under the same key, which is what `FieldsOf` describes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return Schema.Struct(fields as FieldsOf<VarsOf<C>>);
};
