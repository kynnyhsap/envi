import { describe, expect, it } from "@effect/vitest";
import { Provider, ProviderFailure, ReferenceFailure } from "@kynnyhsap/envi";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";

import { makeProvider, type Sdk, tokenVariables } from "./Provider.ts";

class FakeDesktopAuth {
  readonly accountName: string;

  constructor(accountName: string) {
    this.accountName = accountName;
  }
}

class FakeAuthExpiredError extends Error {}

class FakeDesktopSessionExpiredError extends Error {}

class FakeRateLimitExceededError extends Error {}

interface FakeSdk extends Sdk<FakeDesktopAuth> {
  readonly connections: Array<string | FakeDesktopAuth>;
  readonly batches: Array<ReadonlyArray<string>>;
}

/**
 * A faithful SDK: one client for each `createClient`, and one response for each reference.
 * `connectFailure` replaces the client with a rejected or a pending promise.
 */
const fakeSdk = (
  secrets: Readonly<Record<string, string>>,
  connectFailure?: () => Promise<never>,
): FakeSdk => {
  const connections: Array<string | FakeDesktopAuth> = [];
  const batches: Array<ReadonlyArray<string>> = [];

  return {
    connections,
    batches,
    DesktopAuth: FakeDesktopAuth,
    AuthExpiredError: FakeAuthExpiredError,
    DesktopSessionExpiredError: FakeDesktopSessionExpiredError,
    RateLimitExceededError: FakeRateLimitExceededError,
    createClient: (config) => {
      if (connectFailure !== undefined) {
        return connectFailure();
      }

      connections.push(config.auth);

      return Promise.resolve({
        secrets: {
          resolveAll: (references) => {
            batches.push(references);

            return Promise.resolve({
              individualResponses: Object.fromEntries(
                references.map((reference) => {
                  const secret = secrets[reference];

                  return [
                    reference,
                    secret === undefined
                      ? { content: null, error: { type: "fieldNotFound" } }
                      : { content: { secret }, error: null },
                  ];
                }),
              ),
            });
          },
        },
      });
    },
  };
};

const withEnv = (env: Readonly<Record<string, string>>) =>
  Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)));

const requests = [
  { key: "a", reference: { uri: "op://app/postgres/url" } },
  { key: "b", reference: { vault: "app", item: "stripe", field: "key" } },
  { key: "c", reference: { uri: "op://app/missing/field" } },
];

const secrets = { "op://app/postgres/url": "postgres://fake", "op://app/stripe/key": "sk_fake" };

describe("onePasswordProvider", () => {
  it("declares its token variables, so that run removes them from the child", () => {
    const provider = makeProvider({}, Effect.succeed(fakeSdk(secrets)));

    expect(provider.credentialVariables).toEqual(tokenVariables);
    expect(tokenVariables).toContain("OP_SERVICE_ACCOUNT_TOKEN");
  });

  it.effect("resolves one batch through desktop authentication", () =>
    Effect.gen(function* () {
      const sdk = fakeSdk(secrets);
      const provider = makeProvider({ account: "my-team" }, Effect.succeed(sdk));
      const results = yield* provider.resolveMany(requests, { interactive: true });

      expect(results).toEqual({
        a: Result.succeed("postgres://fake"),
        b: Result.succeed("sk_fake"),
        c: Result.fail(ReferenceFailure.NotFound),
      });
      expect(sdk.connections).toEqual([new FakeDesktopAuth("my-team")]);
      expect(sdk.batches).toEqual([
        ["op://app/postgres/url", "op://app/stripe/key", "op://app/missing/field"],
      ]);

      yield* provider.resolveMany(requests, { interactive: true });

      expect(sdk.connections.length).toBe(1);
    }).pipe(withEnv({})),
  );

  it.effect("does not load the SDK before the first resolve", () =>
    Effect.gen(function* () {
      let loads = 0;

      const provider = makeProvider(
        { account: "my-team" },
        Effect.sync(() => {
          loads += 1;

          return fakeSdk(secrets);
        }),
      );

      expect(Provider.isProvider(provider)).toBe(true);
      expect(provider.helpers.op("op://app/postgres/url").isRedacted).toBe(true);
      yield* provider.prepare({ uri: "op://app/postgres/url" });
      expect(loads).toBe(0);
    }).pipe(withEnv({})),
  );

  it.effect("uses one client for each account of a reference", () =>
    Effect.gen(function* () {
      const sdk = fakeSdk(secrets);
      const provider = makeProvider({ account: "my-team" }, Effect.succeed(sdk));

      yield* provider.resolveMany(
        [
          { key: "a", reference: { uri: "op://app/postgres/url" } },
          {
            key: "b",
            reference: { account: "partner-team", vault: "app", item: "stripe", field: "key" },
          },
        ],
        { interactive: true },
      );

      expect(sdk.connections).toEqual([
        new FakeDesktopAuth("my-team"),
        new FakeDesktopAuth("partner-team"),
      ]);
    }).pipe(withEnv({})),
  );

  it.effect("prefers a service account token, and the ENVI variable wins", () =>
    Effect.gen(function* () {
      const sdk = fakeSdk(secrets);
      const provider = makeProvider({ account: "my-team" }, Effect.succeed(sdk));

      yield* provider.resolveMany(requests, { interactive: false });

      expect(sdk.connections).toEqual(["ops_envi"]);
    }).pipe(
      withEnv({
        OP_SERVICE_ACCOUNT_TOKEN: "ops_generic",
        ENVI_PROVIDER_ONEPASSWORD_SERVICE_ACCOUNT_TOKEN: "ops_envi",
      }),
    ),
  );

  it.effect("treats an empty token as absent and falls back to the next source", () =>
    Effect.gen(function* () {
      const sdk = fakeSdk(secrets);
      const provider = makeProvider({ account: "my-team" }, Effect.succeed(sdk));

      yield* provider.resolveMany(requests, { interactive: true });

      expect(sdk.connections[0]).toBeInstanceOf(FakeDesktopAuth);
    }).pipe(
      withEnv({
        ENVI_PROVIDER_ONEPASSWORD_SERVICE_ACCOUNT_TOKEN: "",
        OP_SERVICE_ACCOUNT_TOKEN: " ",
      }),
    ),
  );

  it.effect("gives all three forms one reference key, and keeps the account apart", () =>
    Effect.gen(function* () {
      const provider = makeProvider({ account: "my-team" }, Effect.succeed(fakeSdk(secrets)));
      const fromUri = yield* provider.prepare({ uri: "op://app/postgres/url" });
      const fromParts = yield* provider.prepare({ vault: "app", item: "postgres", field: "url" });

      const other = yield* provider.prepare({
        account: "partner-team",
        vault: "app",
        item: "postgres",
        field: "url",
      });

      expect(fromUri.description).toBe("op://app/postgres/url");
      expect(fromUri.referenceKey).toBe(fromParts.referenceKey);
      expect(other.referenceKey).not.toBe(fromUri.referenceKey);
    }).pipe(withEnv({})),
  );

  it.effect("binds the scope to the credential: the account, or the token itself", () =>
    Effect.gen(function* () {
      const provider = makeProvider({ account: "my-team" }, Effect.succeed(fakeSdk(secrets)));
      const desktop = yield* provider.scope.pipe(withEnv({}));

      const otherAccount = yield* provider.scope.pipe(
        withEnv({ ENVI_PROVIDER_ONEPASSWORD_ACCOUNT: "partner-team" }),
      );

      const teamA = yield* provider.scope.pipe(withEnv({ OP_SERVICE_ACCOUNT_TOKEN: "ops_team_a" }));
      const teamB = yield* provider.scope.pipe(withEnv({ OP_SERVICE_ACCOUNT_TOKEN: "ops_team_b" }));

      expect(new Set([desktop, otherAccount, teamA, teamB]).size).toBe(4);
    }),
  );

  it.effect("reads the account from the environment before the settings", () =>
    Effect.gen(function* () {
      const sdk = fakeSdk(secrets);
      const provider = makeProvider({ account: "my-team" }, Effect.succeed(sdk));

      yield* provider.resolveMany(requests, { interactive: true });

      expect(sdk.connections).toEqual([new FakeDesktopAuth("partner-team")]);
    }).pipe(withEnv({ ENVI_PROVIDER_ONEPASSWORD_ACCOUNT: "partner-team" })),
  );

  it.effect("fails at once without a token when the run is not interactive", () =>
    Effect.gen(function* () {
      const sdk = fakeSdk(secrets);
      const provider = makeProvider({ account: "my-team" }, Effect.succeed(sdk));
      const error = yield* Effect.flip(provider.resolveMany(requests, { interactive: false }));

      expect(error).toMatchObject({ reason: ProviderFailure.AuthenticationFailed });
      expect(sdk.connections).toEqual([]);
    }).pipe(withEnv({})),
  );

  it.effect("fails with Misconfigured without an account and without a token", () =>
    Effect.gen(function* () {
      const provider = makeProvider({}, Effect.succeed(fakeSdk(secrets)));
      const error = yield* Effect.flip(provider.resolveMany(requests, { interactive: true }));

      expect(error).toMatchObject({ reason: ProviderFailure.Misconfigured });
    }).pipe(withEnv({})),
  );

  it.effect("reports a failed desktop connection as Unavailable", () =>
    Effect.gen(function* () {
      const provider = makeProvider(
        { account: "my-team" },
        Effect.succeed(fakeSdk(secrets, () => Promise.reject(new Error("the app is locked")))),
      );

      const error = yield* Effect.flip(provider.resolveMany(requests, { interactive: true }));

      expect(error).toMatchObject({ reason: ProviderFailure.Unavailable });
    }).pipe(withEnv({})),
  );

  describe("with a token that the SDK cannot use", () => {
    const failureOf = (rejection: Error) =>
      Effect.gen(function* () {
        const sdk = fakeSdk(secrets, () => Promise.reject(rejection));
        const provider = makeProvider({ serviceAccountToken: "ops_fake" }, Effect.succeed(sdk));

        return yield* Effect.flip(provider.resolveMany(requests, { interactive: false }));
      }).pipe(withEnv({}));

    it.effect("classifies the SDK errors, so an outage allows an expired cache entry", () =>
      Effect.gen(function* () {
        const limited = yield* failureOf(new FakeRateLimitExceededError("slow down"));
        const expired = yield* failureOf(new FakeAuthExpiredError("expired"));
        const rejected = yield* failureOf(new Error("invalid service account token"));
        const offline = yield* failureOf(new Error("error sending request"));

        expect(limited).toMatchObject({ reason: ProviderFailure.Unavailable });
        expect(expired).toMatchObject({ reason: ProviderFailure.AuthenticationFailed });
        expect(rejected).toMatchObject({ reason: ProviderFailure.AuthenticationFailed });
        expect(offline).toMatchObject({ reason: ProviderFailure.Unavailable });
        expect(JSON.stringify([limited, expired, rejected, offline])).not.toContain("ops_fake");
      }),
    );

    it.effect("fails with Unavailable when the SDK does not answer in time", () =>
      Effect.gen(function* () {
        const sdk = fakeSdk(secrets, () => new Promise<never>(() => {}));
        const provider = makeProvider({ serviceAccountToken: "ops_fake" }, Effect.succeed(sdk));

        const fiber = yield* Effect.forkChild(
          Effect.flip(provider.resolveMany(requests, { interactive: false })),
        );

        yield* TestClock.adjust("31 seconds");

        const error = yield* Fiber.join(fiber);

        expect(error).toMatchObject({ reason: ProviderFailure.Unavailable });
        expect(error.message).toContain("did not answer");
      }).pipe(withEnv({})),
    );
  });
});
