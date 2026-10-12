// The credential of one operation: a service account token, or desktop authentication through the
// 1Password app. An environment variable wins over a setting, unless `credentialFromEnvironment` is
// `false`, and a token wins over an account.
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
  /**
   * `false` ignores the token and the account variables, so only these settings select the
   * credential. A program that chooses its own credential sets it. Default: `true`.
   */
  readonly credentialFromEnvironment?: boolean;
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

/** Whether the variables of the environment can select the credential. */
export const fromEnvironment = (settings: OnePasswordSettings): boolean =>
  settings.credentialFromEnvironment !== false;

/** The settings that a variable can replace. */
export const CredentialSetting = {
  ServiceAccountToken: "serviceAccountToken",
  Account: "account",
} as const;

/** The schema of `CredentialSetting`. */
export const CredentialSettingSchema = Schema.Enum(CredentialSetting);

export type CredentialSetting = typeof CredentialSettingSchema.Type;

/** A variable that replaced another value of a setting. It holds names, never a value. */
export const Replacement = Schema.Struct({
  variable: Schema.String,
  setting: CredentialSettingSchema,
});

export type Replacement = typeof Replacement.Type;

/** The credential of one operation, and each setting that a variable replaced. */
export const Reading = Schema.Struct({
  credential: Credential,
  replaced: Schema.Array(Replacement),
});

export type Reading = typeof Reading.Type;

/** One value from the first of the variables that holds one, and the name of that variable. */
const firstVariable = <A>(
  names: ReadonlyArray<string>,
  config: (name: string) => Config.Config<A>,
  present: (value: A) => boolean,
) =>
  Effect.gen(function* () {
    for (const name of names) {
      const found = Option.filter(yield* readOptional(config(name), name), present);

      if (Option.isSome(found)) {
        return Option.some({ name, value: found.value });
      }
    }

    return Option.none<{ readonly name: string; readonly value: A }>();
  });

/** The variable wins over the setting. It replaces the setting only when their values differ. */
const choose = <A>(
  variable: Option.Option<{ readonly name: string; readonly value: A }>,
  setting: Option.Option<A>,
  name: CredentialSetting,
  text: (value: A) => string,
) => ({
  value: Option.orElse(
    Option.map(variable, (found) => found.value),
    () => setting,
  ),
  replaced: Option.match(Option.all([variable, setting]), {
    onNone: (): ReadonlyArray<Replacement> => [],
    onSome: ([found, value]) =>
      text(found.value) === text(value) ? [] : [{ variable: found.name, setting: name }],
  }),
});

const isPresentToken = (token: Redacted.Redacted): boolean => isPresent(Redacted.value(token));

/** Reads the credential of one operation from the environment and the settings. */
export const read = (settings: OnePasswordSettings): Effect.Effect<Reading, ProviderError> =>
  Effect.gen(function* () {
    const variables = fromEnvironment(settings);

    const token = choose(
      yield* firstVariable(variables ? tokenVariables : [], Config.Redacted, isPresentToken),
      Option.fromUndefinedOr(settings.serviceAccountToken).pipe(
        Option.map((value) => (Predicate.isString(value) ? Redacted.make(value) : value)),
        Option.filter(isPresentToken),
      ),
      CredentialSetting.ServiceAccountToken,
      Redacted.value,
    );

    if (Option.isSome(token.value)) {
      return {
        credential: { kind: CredentialKind.ServiceAccount, token: token.value.value },
        replaced: token.replaced,
      };
    }

    const account = choose(
      yield* firstVariable(variables ? [accountVariable] : [], Config.String, isPresent),
      Option.filter(Option.fromUndefinedOr(settings.account), isPresent),
      CredentialSetting.Account,
      String,
    );

    return {
      credential: { kind: CredentialKind.Desktop, account: account.value },
      replaced: account.replaced,
    };
  });

/**
 * The scope of a credential. The token itself selects the vaults, so two tokens never share a
 * cache entry. The core hashes the scope. The text is part of the cache key: do not change it.
 */
export const scopeOf = (credential: Credential): string =>
  credential.kind === CredentialKind.ServiceAccount
    ? `${credential.kind}:${Redacted.value(credential.token)}`
    : `${credential.kind}:${Option.getOrElse(credential.account, () => "")}`;
