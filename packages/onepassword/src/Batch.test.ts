import { describe, expect, it } from "@effect/vitest";
import { ReferenceFailure } from "@kynnyhsap/envi";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import * as Batch from "./Batch.ts";
import { CredentialKind } from "./Credential.ts";
import type { Sdk, SdkClient, SdkResponse } from "./Sdk.ts";

class FakeDesktopAuth {
  readonly accountName: string;

  constructor(accountName: string) {
    this.accountName = accountName;
  }
}

const sdk: Sdk<FakeDesktopAuth> = {
  DesktopAuth: FakeDesktopAuth,
  AuthExpiredError: class extends Error {},
  DesktopSessionExpiredError: class extends Error {},
  RateLimitExceededError: class extends Error {},
  createClient: () => Promise.reject(new Error("unused")),
};

/** A client that answers every batch with the given responses. */
const clientOf = (
  individualResponses: Readonly<Record<string, SdkResponse>>,
): Pick<SdkClient, "secrets"> => ({
  secrets: { resolveAll: () => Promise.resolve({ individualResponses }) },
});

const request = (key: string, field: string) => ({
  key,
  reference: { vault: "app", item: "postgres", field },
});

describe("Batch", () => {
  it.effect("maps each answer to a value, NotFound, AccessDenied, or Invalid", () =>
    Effect.gen(function* () {
      const client = clientOf({
        "op://app/postgres/url": { content: { secret: "postgres://fake" }, error: null },
        "op://app/postgres/port": { content: null, error: { type: "itemNotFound" } },
        "op://app/postgres/user": { content: null, error: { type: "other" } },
        "op://app/postgres/host": { content: null, error: { type: "tooManyItems" } },
      });

      const results = yield* Batch.resolve(sdk, CredentialKind.ServiceAccount, client, [
        request("a", "url"),
        request("b", "port"),
        request("c", "user"),
        request("d", "host"),
      ]);

      expect(results).toEqual({
        a: Result.succeed("postgres://fake"),
        b: Result.fail(ReferenceFailure.NotFound),
        c: Result.fail(ReferenceFailure.AccessDenied),
        d: Result.fail(ReferenceFailure.Invalid),
      });
    }),
  );
});
