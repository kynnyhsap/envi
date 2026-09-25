import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import type * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  ProviderError,
  ProviderFailure,
  SecretReferenceError,
  ReferenceFailure,
} from "./Errors.ts";

/** The brand of a provider. It is a registered symbol, so a second copy of this module agrees. */
export const TypeId: unique symbol = Symbol.for("envi/Provider");

/** One reference of a batch. The provider returns its result under `key`. */
export interface ProviderRequest<Ref> {
  readonly key: string;
  readonly reference: Ref;
}

/** The conditions of one provider call. */
export interface ResolveContext {
  /** `false` in CI. A provider must not open a prompt or use desktop authentication then. */
  readonly interactive: boolean;
}

/** The results of one batch, keyed by request key. A failure holds only its reason code. */
export type BatchResults = Readonly<Record<string, Result.Result<string, ReferenceFailure>>>;

/**
 * What a provider author writes. Unstable until a second real provider proves it.
 *
 * @template Ref - The decoded reference type of the provider.
 * @template Helpers - The descriptor helpers that `vars` receives, such as `{ op }`.
 */
export interface Definition<Ref, Helpers extends object> {
  readonly id: string;
  /** Decodes the JSON reference of a descriptor. */
  readonly Reference: Schema.Codec<Ref, Schema.Json>;
  /** Safe text for reports, errors, and logs. It never holds a secret. */
  readonly describe: (reference: Ref) => string;
  /**
   * Everything outside a reference that decides where its value comes from: the account, the
   * host, the credential. Two instances with different scopes never share a cache entry. The core
   * hashes the scope and never stores, shows, or logs it, so it may hold a credential.
   */
  readonly scope: string | Effect.Effect<string, ProviderError>;
  /**
   * The part of the cache key for one reference. Default: `describe`. Override it when
   * `describe` leaves out a part that selects the value.
   */
  readonly referenceKey?: (reference: Ref) => string;
  /**
   * The environment variables that hold a credential of the provider. `run` removes them from
   * the environment of the child. Default: none.
   */
  readonly credentialVariables?: ReadonlyArray<string>;
  /** The only resolve method. Envi rejects a result with a missing or an unknown key. */
  readonly resolveMany: (
    requests: ReadonlyArray<ProviderRequest<Ref>>,
    context: ResolveContext,
  ) => Effect.Effect<BatchResults, ProviderError>;
  readonly helpers: Helpers;
}

/**
 * The definition of a provider whose reference is a plain string. `describe` defaults to
 * `<id>://<reference>`.
 */
export type StringDefinition<Helpers extends object> = Omit<
  Definition<string, Helpers>,
  "Reference" | "describe"
> & {
  readonly describe?: (reference: string) => string;
};

/** The safe identity of one reference. The core adds the provider id and the scope hash. */
export interface PreparedReference {
  readonly referenceKey: string;
  readonly description: string;
}

/**
 * A provider as the core uses it. The reference type is erased: every method takes the JSON
 * reference of a descriptor and decodes it with the schema of the provider.
 *
 * @template Helpers - The descriptor helpers that `vars` receives.
 */
export interface Provider<out Helpers extends object = object> {
  readonly [TypeId]: typeof TypeId;
  readonly id: string;
  readonly helpers: Helpers;
  /** The credential variables of `Definition`. `run` removes them from the child. */
  readonly credentialVariables: ReadonlyArray<string>;
  /** The scope of `Definition`. It can hold a credential, so only a hash of it leaves the core. */
  readonly scope: Effect.Effect<string, ProviderError>;
  /** Decodes one reference. Fails with `Invalid` when the reference does not fit the provider. */
  readonly prepare: (
    reference: Schema.Json,
  ) => Effect.Effect<PreparedReference, SecretReferenceError | ProviderError>;
  readonly resolveMany: (
    requests: ReadonlyArray<ProviderRequest<Schema.Json>>,
    context: ResolveContext,
  ) => Effect.Effect<BatchResults, ProviderError | SecretReferenceError>;
}

const invalidReference = (provider: string): SecretReferenceError =>
  new SecretReferenceError({
    reason: ReferenceFailure.Invalid,
    provider,
    reference: "a reference that does not match the schema of the provider",
  });

const fromDefinition = <Ref, Helpers extends object>(
  definition: Definition<Ref, Helpers>,
): Provider<Helpers> => {
  const decodeReference = (reference: Schema.Json): Effect.Effect<Ref, SecretReferenceError> =>
    Schema.decodeEffect(definition.Reference)(reference).pipe(
      Effect.mapError(() => invalidReference(definition.id)),
    );

  return {
    [TypeId]: TypeId,
    id: definition.id,
    helpers: definition.helpers,
    credentialVariables: definition.credentialVariables ?? [],
    scope: Effect.isEffect(definition.scope) ? definition.scope : Effect.succeed(definition.scope),
    prepare: (reference) =>
      Effect.map(decodeReference(reference), (decoded) => ({
        referenceKey: (definition.referenceKey ?? definition.describe)(decoded),
        description: definition.describe(decoded),
      })),
    resolveMany: (requests, context) =>
      Effect.forEach(requests, (request) =>
        Effect.map(decodeReference(request.reference), (decoded) => ({
          key: request.key,
          reference: decoded,
        })),
      ).pipe(Effect.flatMap((decoded) => definition.resolveMany(decoded, context))),
  };
};

/**
 * Builds a provider from its definition. Every provider, also the built-in ones, uses this.
 * Without `Reference`, a reference is a plain string.
 */
export function make<Ref, const Helpers extends object>(
  definition: Definition<Ref, Helpers>,
): Provider<Helpers>;
export function make<const Helpers extends object>(
  definition: StringDefinition<Helpers>,
): Provider<Helpers>;
export function make<Ref, const Helpers extends object>(
  definition: Definition<Ref, Helpers> | StringDefinition<Helpers>,
): Provider<Helpers> {
  return "Reference" in definition
    ? fromDefinition(definition)
    : fromDefinition({
        ...definition,
        Reference: Schema.String,
        describe: definition.describe ?? ((reference) => `${definition.id}://${reference}`),
      });
}

/** Tells whether a value is a provider, also when another copy of this module built it. */
export const isProvider = (input: unknown): input is Provider =>
  Predicate.hasProperty(input, TypeId);

/** The registry of the providers of one client. */
export interface Interface {
  /** Fails with `UnknownProvider` when no provider has the id. */
  readonly get: (id: string) => Effect.Effect<Provider, ProviderError>;
  readonly all: ReadonlyArray<Provider>;
}

/** The service tag of the provider registry. */
export class Providers extends Context.Service<Providers, Interface>()("envi/Providers") {}

const duplicateProvider = (id: string): ProviderError =>
  new ProviderError({
    reason: ProviderFailure.Misconfigured,
    provider: id,
    detail: "Two providers have this id. Each provider id must be unique.",
  });

const unknownProvider = (id: string, known: ReadonlyArray<string>): ProviderError =>
  new ProviderError({
    reason: ProviderFailure.UnknownProvider,
    provider: id,
    detail: `Add the provider to \`providers\`. Known providers: ${known.join(", ") || "none"}.`,
  });

/** Builds the registry. Fails with `Misconfigured` when two providers share one id. */
export const layer = (providers: ReadonlyArray<Provider>): Layer.Layer<Providers, ProviderError> =>
  Layer.effect(
    Providers,
    Effect.gen(function* () {
      const byId = new Map<string, Provider>();

      for (const provider of providers) {
        if (byId.has(provider.id)) {
          return yield* duplicateProvider(provider.id);
        }

        byId.set(provider.id, provider);
      }

      return Providers.of({
        all: providers,
        get: (id) => {
          const provider = byId.get(id);

          return provider === undefined
            ? Effect.fail(unknownProvider(id, [...byId.keys()]))
            : Effect.succeed(provider);
        },
      });
    }),
  );
