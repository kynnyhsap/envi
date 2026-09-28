// The credential of one operation: a service account token, or desktop authentication through the
// 1Password app. An environment variable wins over a setting, and a token wins over an account.
import { type ProviderError, ProviderFailure } from "@kynnyhsap/envi";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { failure } from "./Failure.ts";

/** The settings of the 1Password provider. An environment variable wins over a setting. */
export interface OnePasswordSettings {
  /** The account name from the sidebar of the 1Password app, or the account UUID. */
  readonly account?: string;
  /** The token of a service account. With a token, Envi never uses desktop authentication. */
  readonly serviceAccountToken?: string | Redacted.Redacted;
}

/** The environment variable of the account. */
export const accountVariable = "ENVI_PROVIDER_ONEPASSWORD_ACCOUNT";

/** The environment variables of the service account token, in the order of priority. */
export const tokenVariables: ReadonlyArray<string> = [
  "ENVI_PROVIDER_ONEPASSWORD_SERVICE_ACCOUNT_TOKEN",
  "OP_SERVICE_ACCOUNT_TOKEN",
];

/** The kinds of credential. */
export const CredentialKind = { Desktop: "desktop", ServiceAccount: "service-account" } as const;

/** The schema of `CredentialKind`. */
export const CredentialKindSchema = Schema.Enum(CredentialKind);

export type CredentialKind = typeof CredentialKindSchema.Type;

/** A service account token. It selects the vaults that Envi can read. */
export const ServiceAccount = Schema.Struct({
  kind: Schema.Literal(CredentialKind.ServiceAccount),
  token: Schema.Redacted(Schema.String),
});

/** Desktop authentication. A reference can name its own account instead of this one. */
export const Desktop = Schema.Struct({
  kind: Schema.Literal(CredentialKind.Desktop),
  account: Schema.Option(Schema.String),
});

/** One account of desktop authentication, after the account of a reference won. */
export const DesktopAccount = Schema.Struct({
  kind: Schema.Literal(CredentialKind.Desktop),
  account: Schema.String,
});

/** The credential of one operation. */
export const Credential = Schema.Union([ServiceAccount, Desktop]);

export type Credential = typeof Credential.Type;

const readOptional = <A>(setting: Config.Config<A>, name: string) =>
  Effect.mapError(Config.option(setting), () =>
    failure(ProviderFailure.Misconfigured, `Envi cannot read the variable ${name}.`),
  );

/** An empty or a blank value counts as absent, as an unset variable does. */
const isPresent = (value: string): boolean => value.trim() !== "";

const readToken = (settings: OnePasswordSettings) =>
  Effect.gen(function* () {
    for (const name of tokenVariables) {
      const found = Option.filter(yield* readOptional(Config.Redacted(name), name), (token) =>
        isPresent(Redacted.value(token)),
      );

      if (Option.isSome(found)) {
        return found;
      }
    }

    return Option.fromUndefinedOr(settings.serviceAccountToken).pipe(
      Option.map((token) => (Predicate.isString(token) ? Redacted.make(token) : token)),
      Option.filter((token) => isPresent(Redacted.value(token))),
    );
  });

const readAccount = (settings: OnePasswordSettings) =>
  Effect.map(readOptional(Config.String(accountVariable), accountVariable), (fromVariable) =>
    Option.filter(fromVariable, isPresent).pipe(
      Option.orElse(() => Option.filter(Option.fromUndefinedOr(settings.account), isPresent)),
    ),
  );

/** Reads the credential of one operation from the environment and the settings. */
export const read = (settings: OnePasswordSettings): Effect.Effect<Credential, ProviderError> =>
  Effect.gen(function* () {
    const token = yield* readToken(settings);

    if (Option.isSome(token)) {
      return { kind: CredentialKind.ServiceAccount, token: token.value };
    }

    return { kind: CredentialKind.Desktop, account: yield* readAccount(settings) };
  });

/**
 * The scope of a credential. The token itself selects the vaults, so two tokens never share a
 * cache entry. The core hashes the scope. The text is part of the cache key: do not change it.
 */
export const scopeOf = (credential: Credential): string =>
  credential.kind === CredentialKind.ServiceAccount
    ? `${credential.kind}:${Redacted.value(credential.token)}`
    : `${credential.kind}:${Option.getOrElse(credential.account, () => "")}`;
