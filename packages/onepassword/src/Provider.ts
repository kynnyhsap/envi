// The 1Password provider. It composes the credential, the SDK clients, and the batches: one SDK
// call for the token, or one SDK call for each desktop account.
import { Provider, type ProviderError, ProviderFailure } from "@kynnyhsap/envi";
import * as Arr from "effect/Array";
import * as Cache from "effect/Cache";
import * as Effect from "effect/Effect";
import * as HashSet from "effect/HashSet";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";

import * as Batch from "./Batch.ts";
import * as Clients from "./Clients.ts";
import * as Credential from "./Credential.ts";
import * as Discover from "./Discover.ts";
import { failure } from "./Failure.ts";
import {
  describeReference,
  op,
  type Op,
  type OpReference,
  providerId,
  Reference,
} from "./Reference.ts";
import * as Sdk from "./Sdk.ts";

/** The helpers that `vars` receives from this provider. */
export interface OnePasswordHelpers {
  readonly op: Op;
}

type Request = Provider.ProviderRequest<OpReference>;

/** The account of one request, as far as one is known. The account of the reference wins. */
const withAccount =
  (account: Option.Option<string>) =>
  (
    request: Request,
  ): Result.Result<{ readonly account: string; readonly request: Request }, Request> =>
    Option.fromUndefinedOr(request.reference.account).pipe(
      Option.orElse(() => account),
      Option.map((known) => ({ account: known, request })),
      Result.fromOption(() => request),
    );

/** The next action of a missing credential: the setting, and the variables while they count. */
const setOne = (settings: Credential.OnePasswordSettings, setting: string, variables: string) =>
  Credential.fromEnvironment(settings)
    ? `Pass \`${setting}\` to onePasswordProvider, or set ${variables}.`
    : `Pass \`${setting}\` to onePasswordProvider.`;

const notInteractive = (settings: Credential.OnePasswordSettings) =>
  failure(
    ProviderFailure.AuthenticationFailed,
    `This run is not interactive, so Envi does not use the 1Password app. ${setOne(settings, "serviceAccountToken", Credential.tokenVariables.join(" or "))}`,
  );

const noAccount = (settings: Credential.OnePasswordSettings) =>
  failure(
    ProviderFailure.Misconfigured,
    `No 1Password account is set. ${setOne(settings, "account", Credential.accountVariable)}`,
  );

/** The warning of a variable that replaced a setting. It names both, and never a value. */
const replacedWarning = ({ variable, setting }: Credential.Replacement) =>
  Effect.logWarning(
    `${variable} replaces the setting \`${setting}\` of onePasswordProvider. Pass \`credentialFromEnvironment: false\` to use the setting.`,
  ).pipe(Effect.annotateLogs({ variable, setting }));

/**
 * Reads the credential, and warns once for each provider and each setting that a variable
 * replaced, because every operation reads the credential more than once.
 */
const credentialOf = (
  settings: Credential.OnePasswordSettings,
  warned: Ref.Ref<HashSet.HashSet<string>>,
) =>
  Effect.flatMap(Credential.read(settings), ({ credential, replaced }) =>
    Effect.as(
      Effect.forEach(replaced, (replacement) =>
        Effect.flatMap(
          Ref.modify(warned, (seen) => {
            const key = `${replacement.variable}|${replacement.setting}`;

            return [HashSet.has(seen, key), HashSet.add(seen, key)] as const;
          }),
          (seen) => (seen ? Effect.void : replacedWarning(replacement)),
        ),
      ),
      credential,
    ),
  );

/** The client of the account of the provider, for a search, which names no account. */
const defaultClient = (
  settings: Credential.OnePasswordSettings,
  readCredential: Effect.Effect<Credential.Credential, ProviderError>,
  clients: Clients.Clients,
  context: Provider.ResolveContext,
) =>
  Effect.gen(function* () {
    const credential = yield* readCredential;

    if (credential.kind === Credential.CredentialKind.ServiceAccount) {
      return { kind: credential.kind, client: yield* Cache.get(clients, credential) };
    }

    if (!context.interactive) {
      return yield* notInteractive(settings);
    }

    const account = yield* Option.match(credential.account, {
      onNone: () => Effect.fail(noAccount(settings)),
      onSome: Effect.succeed,
    });

    return {
      kind: credential.kind,
      client: yield* Cache.get(clients, { kind: credential.kind, account }),
    };
  });

/**
 * Builds the provider on top of an SDK loader. `onePasswordProvider` passes the real SDK.
 *
 * @param loadSdk - Runs on the first cache miss only, because the SDK and its client are slow.
 */
export const makeProvider = <DesktopAuth>(
  settings: Credential.OnePasswordSettings,
  loadSdk: Effect.Effect<Sdk.Sdk<DesktopAuth>, ProviderError>,
): Provider.Provider<OnePasswordHelpers> => {
  // `Provider.make` is synchronous, and the cache needs no service to exist. Each lookup runs with
  // the services of its caller, such as the clock and the log level.
  const clients = Effect.runSync(Clients.make(loadSdk));
  const readCredential = credentialOf(settings, Effect.runSync(Ref.make(HashSet.empty<string>())));

  return Provider.make({
    id: providerId,
    Reference,
    describe: describeReference,
    credentialVariables: Credential.tokenVariables,
    scope: Effect.map(readCredential, Credential.scopeOf),
    // `describe` never holds the account, but the account of a reference selects its value. The
    // text is part of the cache key: do not change it.
    referenceKey: (reference) => `${reference.account ?? ""}|${describeReference(reference)}`,
    resolveMany: (requests, context) =>
      Effect.gen(function* () {
        const credential = yield* readCredential;

        if (credential.kind === Credential.CredentialKind.ServiceAccount) {
          const client = yield* Cache.get(clients, credential);

          return yield* Batch.resolve(yield* loadSdk, credential.kind, client, requests);
        }

        if (!context.interactive) {
          return yield* notInteractive(settings);
        }

        const sdk = yield* loadSdk;
        const [known, unknown] = Arr.partition(requests, withAccount(credential.account));

        if (Arr.isReadonlyArrayNonEmpty(unknown)) {
          return yield* noAccount(settings);
        }

        const batches = yield* Effect.forEach(
          Object.entries(Arr.groupBy(known, (entry) => entry.account)),
          ([account, group]) =>
            Effect.flatMap(Cache.get(clients, { kind: credential.kind, account }), (client) =>
              Batch.resolve(
                sdk,
                credential.kind,
                client,
                group.map((entry) => entry.request),
              ),
            ),
        );

        return Object.fromEntries(batches.flatMap((batch) => Object.entries(batch)));
      }),
    discover: (queries, context) =>
      Effect.gen(function* () {
        const { kind, client } = yield* defaultClient(settings, readCredential, clients, context);

        return yield* Discover.discover(yield* loadSdk, kind, client, queries);
      }),
    helpers: { op },
  });
};

/** The 1Password provider. It imports `@1password/sdk` on the first cache miss only. */
export const onePasswordProvider = (
  settings: Credential.OnePasswordSettings = {},
): Provider.Provider<OnePasswordHelpers> => makeProvider(settings, Sdk.load);
