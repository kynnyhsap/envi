import { Provider, ProviderError, ProviderFailure, ReferenceFailure } from "@envi/core";
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";

import {
  describeReference,
  op,
  type OpReference,
  providerId,
  Reference,
  type Op,
} from "./Reference.ts";

/** The settings of the 1Password provider. An environment variable wins over a setting. */
export interface OnePasswordSettings {
  /** The account name from the sidebar of the 1Password app, or the account UUID. */
  readonly account?: string;
  /** The token of a service account. With a token, Envi never uses desktop authentication. */
  readonly serviceAccountToken?: string | Redacted.Redacted;
}

/** The helpers that `vars` receives from this provider. */
export interface OnePasswordHelpers {
  readonly op: Op;
}

/** The part of one SDK client that Envi uses. */
export interface SdkClient {
  readonly secrets: {
    readonly resolveAll: (references: Array<string>) => Promise<{
      readonly individualResponses: Readonly<
        Record<
          string,
          {
            readonly content?: { readonly secret: string } | null;
            readonly error?: { readonly type: string } | null;
          }
        >
      >;
    }>;
  };
}

/** The part of `@1password/sdk` that Envi uses. Tests pass an in-memory implementation. */
export interface Sdk<DesktopAuth> {
  readonly DesktopAuth: new (accountName: string) => DesktopAuth;
  readonly createClient: (config: {
    readonly auth: string | DesktopAuth;
    readonly integrationName: string;
    readonly integrationVersion: string;
  }) => Promise<SdkClient>;
}

/** The environment variable of the account. */
export const accountVariable = "ENVI_PROVIDER_ONEPASSWORD_ACCOUNT";

/** The environment variables of the service account token, in the order of priority. */
export const tokenVariables: ReadonlyArray<string> = [
  "ENVI_PROVIDER_ONEPASSWORD_SERVICE_ACCOUNT_TOKEN",
  "OP_SERVICE_ACCOUNT_TOKEN",
];

const CredentialKind = { Desktop: "desktop", ServiceAccount: "service-account" } as const;

const integrationName = "envi";

const integrationVersion = "1.0.0";

/** The SDK error types that mean that a vault, an item, a section, or a field does not exist. */
const notFoundTypes: ReadonlyArray<string> = [
  "fieldNotFound",
  "vaultNotFound",
  "itemNotFound",
  "noMatchingSections",
];

type BatchEntry = readonly [key: string, result: Result.Result<string, ReferenceFailure>];

const failure = (reason: ProviderFailure, detail: string): ProviderError =>
  new ProviderError({ reason, provider: providerId, detail });

const readOptional = <A>(setting: Config.Config<A>, name: string) =>
  Effect.mapError(Config.option(setting), () =>
    failure(ProviderFailure.Misconfigured, `Envi cannot read the variable ${name}.`),
  );

/** The account of one reference, as far as one is known. The reference wins. */
const accountOf = (reference: OpReference, account: Option.Option<string>) =>
  Option.orElse(Option.fromUndefinedOr(reference.account), () => account);

/**
 * Builds the provider on top of an SDK loader. `onePasswordProvider` passes the real SDK.
 *
 * @param loadSdk - Runs on the first cache miss only, because the SDK and its client are slow.
 */
export const makeProvider = <DesktopAuth>(
  settings: OnePasswordSettings,
  loadSdk: Effect.Effect<Sdk<DesktopAuth>, ProviderError>,
): Provider.Provider<OnePasswordHelpers> => {
  const clients = new Map<string, Effect.Effect<SdkClient, ProviderError>>();

  const readToken = Effect.gen(function* () {
    for (const name of tokenVariables) {
      const found = yield* readOptional(Config.Redacted(name), name);

      if (Option.isSome(found)) {
        return found;
      }
    }

    return Option.map(Option.fromUndefinedOr(settings.serviceAccountToken), (token) =>
      Predicate.isString(token) ? Redacted.make(token) : token,
    );
  });

  const readAccount = Effect.map(
    readOptional(Config.String(accountVariable), accountVariable),
    Option.orElse(() => Option.fromUndefinedOr(settings.account)),
  );

  const connect = (auth: string | DesktopAuth, sdk: Sdk<DesktopAuth>, kind: string) =>
    Effect.tryPromise({
      try: () => sdk.createClient({ auth, integrationName, integrationVersion }),
      catch: () =>
        kind === CredentialKind.ServiceAccount
          ? failure(
              ProviderFailure.AuthenticationFailed,
              "1Password rejected the service account token.",
            )
          : failure(
              ProviderFailure.Unavailable,
              "The 1Password app did not authorize Envi. Unlock the app, approve the prompt, and enable the SDK integration in Settings > Developer.",
            ),
    });

  /** One client for each account in one process. A failed connection is not kept. */
  const clientFor = (key: string, create: Effect.Effect<SdkClient, ProviderError>) =>
    Effect.suspend(() => {
      const known = clients.get(key);

      if (known !== undefined) {
        return known;
      }

      return Effect.tap(create, (client) =>
        Effect.sync(() => clients.set(key, Effect.succeed(client))),
      );
    });

  const resolveWith = (
    client: SdkClient,
    requests: ReadonlyArray<Provider.ProviderRequest<OpReference>>,
  ) =>
    Effect.tryPromise({
      try: () =>
        client.secrets.resolveAll(requests.map((request) => describeReference(request.reference))),
      catch: () =>
        failure(ProviderFailure.Unavailable, "The request to 1Password failed or timed out."),
    }).pipe(
      Effect.flatMap(({ individualResponses }) =>
        Effect.forEach(requests, (request): Effect.Effect<BatchEntry, ProviderError> => {
          const response = individualResponses[describeReference(request.reference)];

          if (response === undefined) {
            return Effect.fail(
              failure(
                ProviderFailure.InvalidResponse,
                "1Password returned no result for a reference.",
              ),
            );
          }

          // The real SDK sets the unused member to `null`, not to `undefined`.
          if (Predicate.isNotNullish(response.content)) {
            return Effect.succeed([request.key, Result.succeed(response.content.secret)]);
          }

          const reason = notFoundTypes.includes(response.error?.type ?? "")
            ? ReferenceFailure.NotFound
            : ReferenceFailure.Invalid;

          return Effect.succeed([request.key, Result.fail(reason)]);
        }),
      ),
    );

  return Provider.make({
    id: providerId,
    Reference,
    describe: describeReference,
    cacheKey: (reference) =>
      Effect.gen(function* () {
        const kind = Option.isSome(yield* readToken)
          ? CredentialKind.ServiceAccount
          : CredentialKind.Desktop;

        const account = Option.getOrElse(accountOf(reference, yield* readAccount), () => "");

        return [kind, account, describeReference(reference)].join("|");
      }),
    resolveMany: (requests, context) =>
      Effect.gen(function* () {
        const token = yield* readToken;
        const account = yield* readAccount;

        if (Option.isNone(token) && !context.interactive) {
          return yield* failure(
            ProviderFailure.AuthenticationFailed,
            `This run is not interactive, so Envi does not use the 1Password app. Set ${tokenVariables.join(" or ")}.`,
          );
        }

        const sdk = yield* loadSdk;

        if (Option.isSome(token)) {
          const client = yield* clientFor(
            CredentialKind.ServiceAccount,
            connect(Redacted.value(token.value), sdk, CredentialKind.ServiceAccount),
          );

          return Object.fromEntries(yield* resolveWith(client, requests));
        }

        const byAccount = Arr.groupBy(requests, (request) =>
          Option.getOrElse(accountOf(request.reference, account), () => ""),
        );

        if (byAccount[""] !== undefined) {
          return yield* failure(
            ProviderFailure.Misconfigured,
            `No 1Password account is set. Pass \`account\` to onePasswordProvider, or set ${accountVariable}.`,
          );
        }

        const entries = yield* Effect.forEach(Object.entries(byAccount), ([name, group]) =>
          Effect.flatMap(
            clientFor(name, connect(new sdk.DesktopAuth(name), sdk, CredentialKind.Desktop)),
            (client) => resolveWith(client, group),
          ),
        );

        return Object.fromEntries(entries.flat());
      }),
    helpers: { op },
  });
};

const loadRealSdk = Effect.tryPromise({
  try: () => import("@1password/sdk"),
  catch: () =>
    failure(
      ProviderFailure.Misconfigured,
      "The package @1password/sdk does not load. Install it next to @envi/1password.",
    ),
});

/** The 1Password provider. It imports `@1password/sdk` on the first cache miss only. */
export const onePasswordProvider = (
  settings: OnePasswordSettings = {},
): Provider.Provider<OnePasswordHelpers> => makeProvider(settings, loadRealSdk);
