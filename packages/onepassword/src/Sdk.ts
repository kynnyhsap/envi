// The part of `@1password/sdk` that Envi uses, and one guarded call into it. The provider imports
// the real SDK on the first cache miss only, because the SDK and its client are slow to load.
import type * as OnePassword from "@1password/sdk";
import { type ProviderError, ProviderFailure, Timing } from "@kynnyhsap/envi";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

// The npm name and the version of this package come from its manifest, so a rename or a release
// changes only the manifest.
import manifest from "../package.json" with { type: "json" };
import { CredentialKind } from "./Credential.ts";
import { failure } from "./Failure.ts";

/** One answer of `resolveAll`. The real SDK sets the unused member to `null`. */
export const SdkResponse = Schema.Struct({
  content: Schema.optionalKey(Schema.NullOr(Schema.Struct({ secret: Schema.String }))),
  error: Schema.optionalKey(Schema.NullOr(Schema.Struct({ type: Schema.String }))),
});

export type SdkResponse = typeof SdkResponse.Type;

/** The result of one `resolveAll` call: one answer for each reference. */
export const ResolveAllResponse = Schema.Struct({
  individualResponses: Schema.Record(Schema.String, SdkResponse),
});

/** The part of one SDK client that Envi uses. */
export interface SdkClient {
  readonly secrets: {
    // The SDK is the boundary: `Batch` decodes the answer with `ResolveAllResponse`.
    // oxlint-disable-next-line anti-slop/no-unknown-returns
    readonly resolveAll: (references: Array<string>) => Promise<unknown>;
  };
  // The SDK is the boundary: `Discover` decodes each answer with a schema without a value.
  readonly vaults: {
    // oxlint-disable-next-line anti-slop/no-unknown-returns
    readonly list: () => Promise<unknown>;
  };
  readonly items: {
    // oxlint-disable-next-line anti-slop/no-unknown-returns
    readonly list: (vaultId: string) => Promise<unknown>;
    // oxlint-disable-next-line anti-slop/no-unknown-returns
    readonly getAll: (vaultId: string, itemIds: Array<string>) => Promise<unknown>;
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

/** The steps of this provider that `--debug` times. */
export const Step = {
  SdkImport: "onepassword.sdk.import",
  Client: "onepassword.client",
  ResolveAll: "onepassword.resolveAll",
  Discover: "onepassword.discover",
} as const;

/** The name and the version that the 1Password app shows for Envi. */
const integration = { integrationName: "envi", integrationVersion: manifest.version };

/**
 * The time that one SDK call can take. A desktop call waits for the approval of the user. Both
 * stay below the wait for the resolve lock of the cache.
 */
const timeouts: Readonly<Record<CredentialKind, Duration.Duration>> = {
  [CredentialKind.Desktop]: Duration.fromInputUnsafe("90 seconds"),
  [CredentialKind.ServiceAccount]: Duration.fromInputUnsafe("30 seconds"),
};

/** The words of an SDK message about a rejected token. The SDK has no class for this case. */
const rejectedToken = /invalid|unauthori[sz]ed|forbidden|revoked|expired|\b40[13]\b/iu;

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

/**
 * Runs one SDK call with the timeout of its credential.
 *
 * @param unavailable - The detail of a failure that the SDK does not classify.
 */
export const call = <A, DesktopAuth>(
  sdk: Sdk<DesktopAuth>,
  kind: CredentialKind,
  unavailable: string,
  run: () => Promise<A>,
): Effect.Effect<A, ProviderError> =>
  Effect.tryPromise({ try: run, catch: classify(sdk, kind, unavailable) }).pipe(
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

/** The detail of a connection that fails for no known reason, for each credential. */
const unreachable: Readonly<Record<CredentialKind, string>> = {
  [CredentialKind.ServiceAccount]: "Envi cannot reach 1Password.",
  [CredentialKind.Desktop]:
    "The 1Password app did not authorize Envi. Unlock the app, approve the prompt, and enable the SDK integration in Settings > Developer.",
};

/** Creates one SDK client. A desktop client asks the user for approval in the 1Password app. */
export const connect = <DesktopAuth>(
  sdk: Sdk<DesktopAuth>,
  kind: CredentialKind,
  auth: string | DesktopAuth,
): Effect.Effect<SdkClient, ProviderError> =>
  call(sdk, kind, unreachable[kind], () => sdk.createClient({ auth, ...integration })).pipe(
    Timing.measure(Step.Client, { credential: kind }),
  );

/** Imports the real SDK. */
export const load: Effect.Effect<Sdk<OnePassword.DesktopAuth>, ProviderError> = Effect.tryPromise({
  try: () => import("@1password/sdk"),
  catch: () =>
    failure(
      ProviderFailure.Misconfigured,
      `The package @1password/sdk does not load. Install it next to ${manifest.name}.`,
    ),
}).pipe(Timing.measure(Step.SdkImport));
