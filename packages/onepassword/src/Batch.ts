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
import * as Schema from "effect/Schema";

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

/** The SDK gives this error type, without a message, to a credential that cannot read the item. */
const accessDeniedType = "other";

const decodeAnswer = Schema.decodeUnknownEffect(Sdk.ResolveAllResponse);

/** The failure of one SDK error type. The remaining types, such as `parsing`, mean `Invalid`. */
const failureOf = (type: string): ReferenceFailure => {
  if (notFoundTypes.has(type)) {
    return ReferenceFailure.NotFound;
  }

  return type === accessDeniedType ? ReferenceFailure.AccessDenied : ReferenceFailure.Invalid;
};

/** The result of one answer. */
const resultOf = (response: Sdk.SdkResponse): Result.Result<string, ReferenceFailure> =>
  Predicate.isNotNullish(response.content)
    ? Result.succeed(response.content.secret)
    : Result.fail(failureOf(response.error?.type ?? ""));

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
    // The decode error can hold a secret of the answer, so the failure holds only a fixed text.
    Effect.flatMap((answer) =>
      Effect.mapError(decodeAnswer(answer), () =>
        failure(
          ProviderFailure.InvalidResponse,
          "1Password returned an answer of an unknown form.",
        ),
      ),
    ),
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
