import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import {
  Cache,
  defineConfig,
  Envi,
  FileCache,
  ProviderFailure,
  ReferenceFailure,
  SecretReferenceError,
  ValueOrigin,
} from "@kynnyhsap/envi";
// Tests against real 1Password. They need the fixture: `bun fixture:onepassword setup`.
// Each suite runs once for each credential of the environment. Without one, the suite skips
// itself. Only a desktop run asks for an approval in the 1Password app.
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import * as Schema from "effect/Schema";

import { type OnePasswordSettings, onePasswordProvider, op } from "../src/index.ts";
import { testCredentials } from "./credentials.ts";
import { expected } from "./expected.ts";
import { fixtureVaults, primaryVault, secondaryVault } from "./fixture.ts";

const configOf = (settings: OnePasswordSettings) =>
  defineConfig({
    providers: [onePasswordProvider(settings)],
    vars: ({ op: secret }) => ({
      DATABASE_URL: secret(`op://${primaryVault}/app/DATABASE_URL`),
      PORT: secret(primaryVault, "app", "PORT").schema(Schema.FiniteFromString),
      SENTRY_DSN: secret({ vault: primaryVault, item: "app", section: "web", field: "SENTRY_DSN" }),
      PRIVATE_KEY: secret(primaryVault, "multiline", "PRIVATE_KEY"),
      STRIPE_KEY: secret(secondaryVault, "payments", "STRIPE_KEY"),
      MISSING: secret(primaryVault, "app", "DOES_NOT_EXIST").optional(),
    }),
  });

// Plaintext in a scoped temp directory: the test never touches the Keychain or ~/.cache/envi.
const TempFileCache = Layer.unwrap(
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "envi-onepassword-" });

    return FileCache.layerPlaintext({ directory });
  }),
);

// No variable of the shell reaches the provider, so only the settings select the credential.
const TestLayer = Layer.provideMerge(
  Layer.provide(Envi.layer(), TempFileCache),
  Layer.merge(NodeServices.layer, ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
);

// A shell with a credential that 1Password rejects, such as a token that was rotated away.
const staleTokenVariable = "ENVI_PROVIDER_ONEPASSWORD_SERVICE_ACCOUNT_TOKEN";

const staleShell = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    [staleTokenVariable]: "ops_stale",
    OP_SERVICE_ACCOUNT_TOKEN: "ops_stale",
    ENVI_PROVIDER_ONEPASSWORD_ACCOUNT: "stale-team",
  }),
);

describe.skipIf(testCredentials.length === 0)("1Password provider against a real account", () => {
  describe.each(testCredentials)("with the $mode", ({ settings }) => {
    const config = configOf(settings);

    layer(TestLayer, { excludeTestServices: true })((it) => {
      it.effect(
        "resolves all three reference forms from two vaults, and then reads the cache",
        () =>
          Effect.gen(function* () {
            const envi = yield* Envi.Envi;
            const env = yield* envi.load(config);
            const stripeKey = yield* expected(secondaryVault, "payments", "STRIPE_KEY");

            expect(env).toEqual({
              DATABASE_URL: yield* expected(primaryVault, "app", "DATABASE_URL"),
              PORT: Number(yield* expected(primaryVault, "app", "PORT")),
              SENTRY_DSN: yield* expected(primaryVault, "app", "SENTRY_DSN"),
              PRIVATE_KEY: yield* expected(primaryVault, "multiline", "PRIVATE_KEY"),
              STRIPE_KEY: stripeKey,
              MISSING: undefined,
            });

            const report = yield* envi.inspect(config);

            const origins = Object.fromEntries(
              report.vars.map((entry) => [entry.key, entry.origin]),
            );

            expect(origins["DATABASE_URL"]).toBe(ValueOrigin.Cache);
            expect(origins["MISSING"]).toBe(ValueOrigin.Unset);
            expect(JSON.stringify(report)).not.toContain(stripeKey);

            const list = yield* envi.cache.list;

            expect(list.entries.map((entry) => entry.reference)).toContain(
              `op://${secondaryVault}/payments/STRIPE_KEY`,
            );
          }),
      );

      it.effect(
        "finds the references of an item and of a reference with a typo, without a value",
        () =>
          Effect.gen(function* () {
            const envi = yield* Envi.Envi;
            const typo = `op://${primaryVault}/app/SENTRY_DS`;

            const report = yield* envi
              .find(config, ["multiline", typo])
              .pipe(Effect.provide(Layer.provide(Envi.layer(), Cache.layerNone)));

            const [multiline, sentry] = report.queries.map((entry) =>
              entry.references.map((found) => found.reference),
            );

            expect(multiline).toContain(`op://${primaryVault}/multiline/PRIVATE_KEY`);
            expect(sentry?.[0]).toBe(`op://${primaryVault}/app/web/SENTRY_DSN`);

            for (const vault of fixtureVaults) {
              for (const item of vault.items) {
                for (const field of item.fields) {
                  expect(JSON.stringify(report)).not.toContain(field.value);
                }
              }
            }
          }),
      );

      it.effect("names the closest reference of a field with a typo, without a value", () =>
        Effect.gen(function* () {
          const envi = yield* Envi.Envi;

          const error = yield* envi
            .resolve(config, op(primaryVault, "app", "SENTRY_DS"))
            .pipe(Effect.provide(Layer.provide(Envi.layer(), Cache.layerNone)), Effect.flip);

          expect(error).toBeInstanceOf(SecretReferenceError);
          expect(error).toMatchObject({ reason: ReferenceFailure.NotFound });
          expect(error instanceof SecretReferenceError ? error.candidates?.[0] : undefined).toBe(
            `op://${primaryVault}/app/web/SENTRY_DSN`,
          );

          for (const vault of fixtureVaults) {
            for (const item of vault.items) {
              for (const field of item.fields) {
                expect(JSON.stringify(error) + String(error)).not.toContain(field.value);
              }
            }
          }
        }),
      );

      it.effect("uses the credential of the program over a stale credential of the shell", () =>
        Effect.gen(function* () {
          const warnings: Array<object> = [];

          const logger = Logger.make(({ logLevel, fiber }) => {
            if (logLevel === "Warn") {
              warnings.push(fiber.getRef(References.CurrentLogAnnotations));
            }
          });

          const resolveWith = (target: OnePasswordSettings) =>
            Envi.Envi.use((envi) =>
              envi.resolve(configOf(target), op(primaryVault, "app", "DATABASE_URL")),
            ).pipe(
              Effect.provide(Layer.provide(Envi.layer(), Cache.layerNone)),
              Effect.provide(Logger.layer([logger])),
              Effect.provide(staleShell),
            );

          const pinned = yield* resolveWith({ ...settings, credentialFromEnvironment: false });
          const error = yield* Effect.flip(resolveWith(settings));

          expect(pinned).toBe(yield* expected(primaryVault, "app", "DATABASE_URL"));
          expect(error).toMatchObject({ reason: ProviderFailure.AuthenticationFailed });
          // A token variable replaces the token of the program. It does not replace an account.
          expect(warnings).toEqual(
            settings.serviceAccountToken === undefined
              ? []
              : [{ variable: staleTokenVariable, setting: "serviceAccountToken" }],
          );
        }),
      );

      it.effect("fails for a missing required field with the safe reference text", () =>
        Effect.gen(function* () {
          const envi = yield* Envi.Envi;

          const error = yield* envi
            .resolve(config, op(primaryVault, "app", "DOES_NOT_EXIST"))
            .pipe(Effect.provide(Layer.provide(Envi.layer(), Cache.layerNone)), Effect.flip);

          expect(error).toBeInstanceOf(SecretReferenceError);
          expect(error).toMatchObject({ reference: `op://${primaryVault}/app/DOES_NOT_EXIST` });
        }),
      );
    });
  });
});
