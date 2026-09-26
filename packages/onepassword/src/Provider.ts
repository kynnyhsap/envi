import {
  Provider,
  ProviderError,
  ProviderFailure,
  ReferenceFailure,
  Timing,
} from "@kynnyhsap/envi";
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";

// The npm name and the version of this package come from its manifest, so a rename or a release
// changes only the manifest.
import manifest from "../package.json" with { type: "json" };
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
  readonly AuthExpiredError: new (message: string) => Error;
  readonly DesktopSessionExpiredError: new (message: string) => Error;
  readonly RateLimitExceededError: new (message: string) => Error;
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

type CredentialKind = (typeof CredentialKind)[keyof typeof CredentialKind];

/**
 * The time that one SDK call can take. A desktop call waits for the approval of the user. Both
 * stay below the wait for the resolve lock of the cache.
 */
const timeouts: Readonly<Record<CredentialKind, Duration.Duration>> = {
  [CredentialKind.Desktop]: Duration.seconds(90),
  [CredentialKind.ServiceAccount]: Duration.seconds(30),
};

/** The words of an SDK message about a rejected token. The SDK has no class for this case. */
const rejectedToken = /invalid|unauthori[sz]ed|forbidden|revoked|expired|\b40[13]\b/iu;

const integrationName = "envi";

const integrationVersion = manifest.version;

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

/**
 * Maps a rejected SDK call to a failure. The message of the SDK stays out of the failure, because
 * it can hold an input. Unavailable allows an expired cache entry, AuthenticationFailed does not.
 */
const classify =
  <DesktopAuth>(sdk: Sdk<DesktopAuth>, kind: CredentialKind, unavailable: string) =>
  (cause: unknown): ProviderError => {
    if (cause instanceof sdk.RateLimitExceededError) {
      return failure(ProviderFailure.Unavailable, "1Password limits the rate of requests now.");
    }

    if (cause instanceof sdk.AuthExpiredError) {
      return failure(
        ProviderFailure.AuthenticationFailed,
        "The 1Password credential expired. Create a new service account token.",
      );
    }

    if (cause instanceof sdk.DesktopSessionExpiredError) {
      return failure(
        ProviderFailure.AuthenticationFailed,
        "The session of the 1Password app expired. Unlock the app and run the command again.",
      );
    }

    if (
      kind === CredentialKind.ServiceAccount &&
      cause instanceof Error &&
      rejectedToken.test(cause.message)
    ) {
      return failure(
        ProviderFailure.AuthenticationFailed,
        "1Password rejected the service account token.",
      );
    }

    return failure(ProviderFailure.Unavailable, unavailable);
  };

/** Runs one SDK call with the timeout of its credential. */
const callSdk = <A, DesktopAuth>(
  sdk: Sdk<DesktopAuth>,
  kind: CredentialKind,
  unavailable: string,
  call: () => Promise<A>,
) =>
  Effect.tryPromise({ try: call, catch: classify(sdk, kind, unavailable) }).pipe(
    Effect.timeoutOrElse({
      duration: timeouts[kind],
      orElse: () =>
        Effect.fail(
          failure(
            ProviderFailure.Unavailable,
            `1Password did not answer within ${Duration.format(timeouts[kind])}.`,
          ),
        ),
    }),
  );

const readOptional = <A>(setting: Config.Config<A>, name: string) =>
  Effect.mapError(Config.option(setting), () =>
    failure(ProviderFailure.Misconfigured, `Envi cannot read the variable ${name}.`),
  );

/** An empty or a blank value counts as absent, as an unset variable does. */
const isPresent = (value: string): boolean => value.trim() !== "";

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

  const readAccount = Effect.map(
    readOptional(Config.String(accountVariable), accountVariable),
    (fromVariable) =>
      Option.filter(fromVariable, isPresent).pipe(
        Option.orElse(() => Option.filter(Option.fromUndefinedOr(settings.account), isPresent)),
      ),
  );

  const connect = (auth: string | DesktopAuth, sdk: Sdk<DesktopAuth>, kind: CredentialKind) =>
    callSdk(
      sdk,
      kind,
      kind === CredentialKind.ServiceAccount
        ? "Envi cannot reach 1Password."
        : "The 1Password app did not authorize Envi. Unlock the app, approve the prompt, and enable the SDK integration in Settings > Developer.",
      () => sdk.createClient({ auth, integrationName, integrationVersion }),
    ).pipe(Timing.measure("onepassword.client", { credential: kind }));

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
    sdk: Sdk<DesktopAuth>,
    kind: CredentialKind,
    client: SdkClient,
    requests: ReadonlyArray<Provider.ProviderRequest<OpReference>>,
  ) =>
    callSdk(sdk, kind, "The request to 1Password failed.", () =>
      client.secrets.resolveAll(requests.map((request) => describeReference(request.reference))),
    ).pipe(
      Timing.measure("onepassword.resolveAll", { references: requests.length }),
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
    credentialVariables: tokenVariables,
    // The token itself selects the vaults, so two tokens never share an entry. The core hashes it.
    scope: Effect.gen(function* () {
      const token = yield* readToken;

      if (Option.isSome(token)) {
        return `${CredentialKind.ServiceAccount}:${Redacted.value(token.value)}`;
      }

      return `${CredentialKind.Desktop}:${Option.getOrElse(yield* readAccount, () => "")}`;
    }),
    // `describe` never holds the account, but the account of a reference selects its value.
    referenceKey: (reference) => `${reference.account ?? ""}|${describeReference(reference)}`,
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

          return Object.fromEntries(
            yield* resolveWith(sdk, CredentialKind.ServiceAccount, client, requests),
          );
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
            (client) => resolveWith(sdk, CredentialKind.Desktop, client, group),
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
      `The package @1password/sdk does not load. Install it next to ${manifest.name}.`,
    ),
}).pipe(Timing.measure("onepassword.sdk.import"));

/** The 1Password provider. It imports `@1password/sdk` on the first cache miss only. */
export const onePasswordProvider = (
  settings: OnePasswordSettings = {},
): Provider.Provider<OnePasswordHelpers> => makeProvider(settings, loadRealSdk);
