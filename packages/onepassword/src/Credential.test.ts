import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { CredentialKind, read, scopeOf } from "./Credential.ts";

const withEnv = (env: Readonly<Record<string, string>>) =>
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)));

describe("Credential", () => {
  it.effect("reads a token before an account", () =>
    Effect.gen(function* () {
      const credential = yield* read({ account: "my-team", serviceAccountToken: "ops_fake" });

      expect(credential.kind).toBe(CredentialKind.ServiceAccount);
    }).pipe(withEnv({})),
  );

  it.effect("reads the account without a token", () =>
    Effect.gen(function* () {
      const credential = yield* read({ account: "my-team" });

      expect(credential).toEqual({ kind: CredentialKind.Desktop, account: Option.some("my-team") });
    }).pipe(withEnv({})),
  );

  it("keeps the scope text, because the scope text is part of the cache key", () => {
    expect(scopeOf({ kind: CredentialKind.ServiceAccount, token: Redacted.make("ops_fake") })).toBe(
      "service-account:ops_fake",
    );
    expect(scopeOf({ kind: CredentialKind.Desktop, account: Option.some("my-team") })).toBe(
      "desktop:my-team",
    );
    expect(scopeOf({ kind: CredentialKind.Desktop, account: Option.none() })).toBe("desktop:");
  });
});
