// The SDK clients of one provider in one process: one for the service account token, and one for
// each desktop account. A failed connection is not kept, so the next operation tries again.
import type { ProviderError } from "@kynnyhsap/envi";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import { CredentialKind } from "./Credential.ts";
import * as Sdk from "./Sdk.ts";

/** The clients of one provider. */
export interface Clients<DesktopAuth> {
  readonly serviceAccount: (
    sdk: Sdk.Sdk<DesktopAuth>,
    token: Redacted.Redacted,
  ) => Effect.Effect<Sdk.SdkClient, ProviderError>;
  readonly desktop: (
    sdk: Sdk.Sdk<DesktopAuth>,
    account: string,
  ) => Effect.Effect<Sdk.SdkClient, ProviderError>;
}

export const make = <DesktopAuth>(): Clients<DesktopAuth> => {
  // The kind leads every key, so an account never takes the client of the token.
  const clients = new Map<string, Sdk.SdkClient>();

  const clientFor = (key: string, connect: () => Effect.Effect<Sdk.SdkClient, ProviderError>) =>
    Effect.suspend(() => {
      const known = clients.get(key);

      return known === undefined
        ? Effect.tap(connect(), (client) => Effect.sync(() => clients.set(key, client)))
        : Effect.succeed(known);
    });

  return {
    serviceAccount: (sdk, token) =>
      clientFor(CredentialKind.ServiceAccount, () =>
        Sdk.connect(sdk, CredentialKind.ServiceAccount, Redacted.value(token)),
      ),
    desktop: (sdk, account) =>
      clientFor(`${CredentialKind.Desktop}:${account}`, () =>
        Sdk.connect(sdk, CredentialKind.Desktop, new sdk.DesktopAuth(account)),
      ),
  };
};
