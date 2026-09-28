// The SDK clients of one provider in one process: one for each service account token, and one for
// each desktop account. Two concurrent operations share one connection. A failed connection is not
// kept, so the next operation tries again.
import type { ProviderError } from "@kynnyhsap/envi";
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { CredentialKind, DesktopAccount, ServiceAccount } from "./Credential.ts";
import * as Sdk from "./Sdk.ts";

/** What one client authenticates with: a token, or one desktop account. */
export const ClientKey = Schema.Union([ServiceAccount, DesktopAccount]);

export type ClientKey = typeof ClientKey.Type;

export type Clients = Cache.Cache<ClientKey, Sdk.SdkClient, ProviderError>;

/** The most clients that one provider keeps: one for each token and each account in use. */
const capacity = 16;

/** A client lives as long as the process. A failed connection expires at once. */
const timeToLive = (exit: Exit.Exit<Sdk.SdkClient, ProviderError>): Duration.Duration =>
  Exit.isSuccess(exit) ? Duration.infinity : Duration.zero;

/** The clients of one provider. `loadSdk` runs before each new connection. */
export const make = <DesktopAuth>(
  loadSdk: Effect.Effect<Sdk.Sdk<DesktopAuth>, ProviderError>,
): Effect.Effect<Clients> =>
  Cache.makeWith(
    (key: ClientKey) =>
      Effect.flatMap(loadSdk, (sdk) =>
        key.kind === CredentialKind.ServiceAccount
          ? Sdk.connect(sdk, key.kind, Redacted.value(key.token))
          : Sdk.connect(sdk, key.kind, new sdk.DesktopAuth(key.account)),
      ),
    { capacity, timeToLive },
  );
