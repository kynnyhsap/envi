import { describe, expect, it } from "@effect/vitest";
import { ProviderFailure, ReferenceFailure } from "@kynnyhsap/envi";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Logger from "effect/Logger";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";

import type { OnePasswordSettings } from "./Credential.ts";
import { makeProvider } from "./Provider.ts";
import type { Sdk } from "./Sdk.ts";

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
        // The search has its own tests in `Discover.test.ts`.
        vaults: { list: () => Promise.resolve([]) },
        items: {
          list: () => Promise.resolve([]),
          getAll: () => Promise.resolve({ individualResponses: [] }),
        },
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

/** Runs an effect and returns the message of each warning. */
const captureWarnings = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const warnings: Array<string> = [];

    const logger = Logger.make(({ logLevel, message }) => {
      if (logLevel === "Warn") {
        warnings.push(String(message));
      }
    });

    yield* effect.pipe(Effect.provide(Logger.layer([logger])));

    return warnings;
  });

const requests = [
  { key: "a", reference: { uri: "op://app/postgres/url" } },
  { key: "b", reference: { vault: "app", item: "stripe", field: "key" } },
  { key: "c", reference: { uri: "op://app/missing/field" } },
];

const secrets = { "op://app/postgres/url": "postgres://fake", "op://app/stripe/key": "sk_fake" };

describe("onePasswordProvider", () => {
  it("declares its token variables, so that run removes them from the child", () => {
    const provider = makeProvider({}, Effect.succeed(fakeSdk(secrets)));

    expect(provider.credentialVariables).toEqual([
      "ENVI_PROVIDER_ONEPASSWORD_SERVICE_ACCOUNT_TOKEN",
      "OP_SERVICE_ACCOUNT_TOKEN",
    ]);
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

  it.effect("shares one client between two concurrent resolves", () =>
    Effect.gen(function* () {
      const sdk = fakeSdk(secrets);
      const provider = makeProvider({ account: "my-team" }, Effect.succeed(sdk));
      const resolve = provider.resolveMany(requests, { interactive: true });

      yield* Effect.all([resolve, resolve], { concurrency: "unbounded" });

      expect(sdk.connections).toEqual([new FakeDesktopAuth("my-team")]);
    }).pipe(withEnv({})),
  );

  it.effect("connects again when the token changes", () =>
    Effect.gen(function* () {
      const sdk = fakeSdk(secrets);
      const provider = makeProvider({}, Effect.succeed(sdk));
      const resolve = provider.resolveMany(requests, { interactive: false });

      yield* resolve.pipe(withEnv({ OP_SERVICE_ACCOUNT_TOKEN: "ops_team_a" }));
      yield* resolve.pipe(withEnv({ OP_SERVICE_ACCOUNT_TOKEN: "ops_team_b" }));
      yield* resolve.pipe(withEnv({ OP_SERVICE_ACCOUNT_TOKEN: "ops_team_a" }));

      expect(sdk.connections).toEqual(["ops_team_a", "ops_team_b"]);
    }),
  );

  it.effect("keeps the client of a token apart from the client of an account", () =>
    Effect.gen(function* () {
      const sdk = fakeSdk(secrets);
      const provider = makeProvider({ account: "service-account" }, Effect.succeed(sdk));

      yield* provider
        .resolveMany(requests, { interactive: false })
        .pipe(withEnv({ OP_SERVICE_ACCOUNT_TOKEN: "ops_fake" }));
      yield* provider.resolveMany(requests, { interactive: true }).pipe(withEnv({}));

      expect(sdk.connections).toEqual(["ops_fake", new FakeDesktopAuth("service-account")]);
    }),
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

  describe("with credentialFromEnvironment false", () => {
    const shell = {
      ENVI_PROVIDER_ONEPASSWORD_SERVICE_ACCOUNT_TOKEN: "ops_shell_envi",
      OP_SERVICE_ACCOUNT_TOKEN: "ops_shell_generic",
      ENVI_PROVIDER_ONEPASSWORD_ACCOUNT: "partner-team",
    };

    it.effect("uses the token of the program over a token of the shell", () =>
      Effect.gen(function* () {
        const settings = { account: "my-team", serviceAccountToken: "ops_program" };
        const pinned = fakeSdk(secrets);
        const shared = fakeSdk(secrets);

        yield* makeProvider(
          { ...settings, credentialFromEnvironment: false },
          Effect.succeed(pinned),
        ).resolveMany(requests, { interactive: false });
        yield* makeProvider(settings, Effect.succeed(shared)).resolveMany(requests, {
          interactive: false,
        });

        expect(pinned.connections).toEqual([settings.serviceAccountToken]);
        expect(shared.connections).toEqual([shell.ENVI_PROVIDER_ONEPASSWORD_SERVICE_ACCOUNT_TOKEN]);
      }).pipe(withEnv(shell)),
    );

    it.effect("asks the app for the account of the program despite a token of the shell", () =>
      Effect.gen(function* () {
        const settings = { account: "my-team", credentialFromEnvironment: false };
        const sdk = fakeSdk(secrets);
        const provider = makeProvider(settings, Effect.succeed(sdk));

        yield* provider.resolveMany(requests, { interactive: true }).pipe(withEnv(shell));

        expect(sdk.connections).toEqual([new FakeDesktopAuth(settings.account)]);
        expect(yield* provider.scope.pipe(withEnv(shell))).toBe(
          yield* provider.scope.pipe(withEnv({})),
        );
      }),
    );
  });

  describe("when a variable and a setting disagree", () => {
    const envToken = "ENVI_PROVIDER_ONEPASSWORD_SERVICE_ACCOUNT_TOKEN";
    const opToken = "OP_SERVICE_ACCOUNT_TOKEN";
    const envAccount = "ENVI_PROVIDER_ONEPASSWORD_ACCOUNT";

    /** One provider, and operations that each read the scope and resolve, as a cache miss does. */
    const runs = (settings: OnePasswordSettings, operations: number) =>
      Effect.gen(function* () {
        const provider = makeProvider(settings, Effect.succeed(fakeSdk(secrets)));

        for (let run = 0; run < operations; run += 1) {
          yield* provider.scope;
          yield* provider.resolveMany(requests, { interactive: true });
        }
      });

    const cases: ReadonlyArray<{
      readonly name: string;
      readonly settings: OnePasswordSettings;
      readonly env: Readonly<Record<string, string>>;
      readonly replaced: ReadonlyArray<readonly [variable: string, setting: string]>;
    }> = [
      {
        name: "the ENVI token variable replaces another token",
        settings: { serviceAccountToken: "ops_program" },
        env: { [envToken]: "ops_shell" },
        replaced: [[envToken, "serviceAccountToken"]],
      },
      {
        name: "OP_SERVICE_ACCOUNT_TOKEN replaces another token",
        settings: { serviceAccountToken: "ops_program" },
        env: { [opToken]: "ops_shell" },
        replaced: [[opToken, "serviceAccountToken"]],
      },
      {
        name: "the account variable replaces another account",
        settings: { account: "my-team" },
        env: { [envAccount]: "partner-team" },
        replaced: [[envAccount, "account"]],
      },
      {
        name: "a variable holds the same token",
        settings: { serviceAccountToken: "ops_program" },
        env: { [envToken]: "ops_program" },
        replaced: [],
      },
      {
        name: "a variable holds the same account",
        settings: { account: "my-team" },
        env: { [envAccount]: "my-team" },
        replaced: [],
      },
      {
        name: "a token variable replaces the account, as in CI",
        settings: { account: "my-team" },
        env: { [opToken]: "ops_ci", [envAccount]: "partner-team" },
        replaced: [],
      },
      {
        name: "credentialFromEnvironment is false",
        settings: {
          account: "my-team",
          serviceAccountToken: "ops_program",
          credentialFromEnvironment: false,
        },
        env: { [envToken]: "ops_shell", [envAccount]: "partner-team" },
        replaced: [],
      },
    ];

    it.effect.each(cases)(
      "warns only for a replaced setting: $name",
      ({ settings, env, replaced }) =>
        Effect.gen(function* () {
          const warnings = yield* captureWarnings(runs(settings, 1)).pipe(withEnv(env));

          expect(warnings.length).toBe(replaced.length);
          replaced.forEach(([variable, setting], index) => {
            expect(warnings[index]).toContain(variable);
            expect(warnings[index]).toContain(setting);
          });
          expect(warnings.join("\n")).not.toMatch(/ops_/);
        }),
    );

    it.effect("warns once for each provider, across several operations", () =>
      Effect.gen(function* () {
        const settings = { serviceAccountToken: "ops_program" };
        const env = { [envToken]: "ops_shell" };
        const once = yield* captureWarnings(runs(settings, 3)).pipe(withEnv(env));
        const two = Effect.zip(runs(settings, 1), runs(settings, 1));

        const twice = yield* captureWarnings(two).pipe(withEnv(env));

        expect(once.length).toBe(1);
        expect(twice.length).toBe(2);
      }),
    );
  });

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

  it.effect("fails the authentication after an expired session, and is Unavailable otherwise", () =>
    Effect.gen(function* () {
      const failureOf = (rejection: Error) => {
        const sdk = fakeSdk(secrets, () => Promise.reject(rejection));
        const provider = makeProvider({ account: "my-team" }, Effect.succeed(sdk));

        return Effect.flip(provider.resolveMany(requests, { interactive: true }));
      };

      const expired = yield* failureOf(new FakeDesktopSessionExpiredError("session expired"));
      const locked = yield* failureOf(new Error("the app is locked"));
      // Only a service account has a token that 1Password can reject.
      const tokenText = yield* failureOf(new Error("invalid service account token"));

      expect(expired).toMatchObject({ reason: ProviderFailure.AuthenticationFailed });
      expect(locked).toMatchObject({ reason: ProviderFailure.Unavailable });
      expect(tokenText).toMatchObject({ reason: ProviderFailure.Unavailable });
    }).pipe(withEnv({})),
  );

  describe("with a token that the SDK cannot use", () => {
    const token = "ops_fake";

    const failureOf = (rejection: Error) =>
      Effect.gen(function* () {
        const sdk = fakeSdk(secrets, () => Promise.reject(rejection));
        const provider = makeProvider({ serviceAccountToken: token }, Effect.succeed(sdk));

        return yield* Effect.flip(provider.resolveMany(requests, { interactive: false }));
      }).pipe(withEnv({}));

    // Each SDK message holds the token, so a failure that copies the message leaks it.
    it.effect("classifies the SDK errors, so an outage allows an expired cache entry", () =>
      Effect.gen(function* () {
        const limited = yield* failureOf(new FakeRateLimitExceededError(`slow down: ${token}`));
        const expired = yield* failureOf(new FakeAuthExpiredError(`expired: ${token}`));
        const rejected = yield* failureOf(new Error(`invalid service account token ${token}`));
        const offline = yield* failureOf(new Error(`error sending request with ${token}`));
        const errors = [limited, expired, rejected, offline];

        expect(limited).toMatchObject({ reason: ProviderFailure.Unavailable });
        expect(expired).toMatchObject({ reason: ProviderFailure.AuthenticationFailed });
        expect(rejected).toMatchObject({ reason: ProviderFailure.AuthenticationFailed });
        expect(offline).toMatchObject({ reason: ProviderFailure.Unavailable });
        expect(JSON.stringify(errors)).not.toContain(token);
        expect(errors.map((error) => error.message).join("\n")).not.toContain(token);
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
      }).pipe(withEnv({})),
    );
  });
});
