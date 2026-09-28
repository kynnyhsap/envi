// One batch of references through one SDK client: one `resolveAll` call, then one result for each
// request.
import {
  type Provider,
  type ProviderError,
  ProviderFailure,
  ReferenceFailure,
  Timing,
} from "@kynnyhsap/envi";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";

import type { CredentialKind } from "./Credential.ts";
import { failure } from "./Failure.ts";
import { describeReference, type OpReference } from "./Reference.ts";
import * as Sdk from "./Sdk.ts";

/** The SDK error types that mean that a vault, an item, a section, or a field does not exist. */
const NotFoundType = {
  Field: "fieldNotFound",
  Vault: "vaultNotFound",
  Item: "itemNotFound",
  Section: "noMatchingSections",
} as const;

const notFoundTypes: ReadonlySet<string> = new Set(Object.values(NotFoundType));

/** The result of one answer. Any other SDK error means that the reference is invalid. */
const resultOf = (response: Sdk.SdkResponse): Result.Result<string, ReferenceFailure> => {
  if (Predicate.isNotNullish(response.content)) {
    return Result.succeed(response.content.secret);
  }

  return Result.fail(
    notFoundTypes.has(response.error?.type ?? "")
      ? ReferenceFailure.NotFound
      : ReferenceFailure.Invalid,
  );
};

/** Resolves one batch of references with one SDK call. */
export const resolve = <DesktopAuth>(
  sdk: Sdk.Sdk<DesktopAuth>,
  kind: CredentialKind,
  client: Sdk.SdkClient,
  requests: ReadonlyArray<Provider.ProviderRequest<OpReference>>,
): Effect.Effect<Provider.BatchResults, ProviderError> =>
  Sdk.call(sdk, kind, "The request to 1Password failed.", () =>
    client.secrets.resolveAll(requests.map((request) => describeReference(request.reference))),
  ).pipe(
    Timing.measure(Sdk.Step.ResolveAll, { references: requests.length }),
    Effect.flatMap(({ individualResponses }) =>
      Effect.forEach(requests, (request) => {
        const response = individualResponses[describeReference(request.reference)];

        return response === undefined
          ? Effect.fail(
              failure(
                ProviderFailure.InvalidResponse,
                "1Password returned no result for a reference.",
              ),
            )
          : Effect.succeed([request.key, resultOf(response)] as const);
      }),
    ),
    Effect.map(Object.fromEntries),
  );
