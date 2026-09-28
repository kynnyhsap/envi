// The 1Password provider. It composes the credential, the SDK clients, and the batches: one SDK
// call for the token, or one SDK call for each desktop account.
import { Provider, type ProviderError, ProviderFailure } from "@kynnyhsap/envi";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import * as Batch from "./Batch.ts";
import * as Clients from "./Clients.ts";
import * as Credential from "./Credential.ts";
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

/**
 * Builds the provider on top of an SDK loader. `onePasswordProvider` passes the real SDK.
 *
 * @param loadSdk - Runs on the first cache miss only, because the SDK and its client are slow.
 */
export const makeProvider = <DesktopAuth>(
  settings: Credential.OnePasswordSettings,
  loadSdk: Effect.Effect<Sdk.Sdk<DesktopAuth>, ProviderError>,
): Provider.Provider<OnePasswordHelpers> => {
  const clients = Clients.make<DesktopAuth>();

  return Provider.make({
    id: providerId,
    Reference,
    describe: describeReference,
    credentialVariables: Credential.tokenVariables,
    scope: Effect.map(Credential.read(settings), Credential.scopeOf),
    // `describe` never holds the account, but the account of a reference selects its value. The
    // text is part of the cache key: do not change it.
    referenceKey: (reference) => `${reference.account ?? ""}|${describeReference(reference)}`,
    resolveMany: (requests, context) =>
      Effect.gen(function* () {
        const credential = yield* Credential.read(settings);

        if (credential.kind === Credential.CredentialKind.ServiceAccount) {
          const sdk = yield* loadSdk;
          const client = yield* clients.serviceAccount(sdk, credential.token);

          return yield* Batch.resolve(sdk, credential.kind, client, requests);
        }

        if (!context.interactive) {
          return yield* failure(
            ProviderFailure.AuthenticationFailed,
            `This run is not interactive, so Envi does not use the 1Password app. Set ${Credential.tokenVariables.join(" or ")}.`,
          );
        }

        const sdk = yield* loadSdk;
        const [unknown, known] = Arr.partition(requests, withAccount(credential.account));

        if (Arr.isReadonlyArrayNonEmpty(unknown)) {
          return yield* failure(
            ProviderFailure.Misconfigured,
            `No 1Password account is set. Pass \`account\` to onePasswordProvider, or set ${Credential.accountVariable}.`,
          );
        }

        const batches = yield* Effect.forEach(
          Object.entries(Arr.groupBy(known, (entry) => entry.account)),
          ([account, group]) =>
            Effect.flatMap(clients.desktop(sdk, account), (client) =>
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
    helpers: { op },
  });
};

/** The 1Password provider. It imports `@1password/sdk` on the first cache miss only. */
export const onePasswordProvider = (
  settings: Credential.OnePasswordSettings = {},
): Provider.Provider<OnePasswordHelpers> => makeProvider(settings, Sdk.load);
