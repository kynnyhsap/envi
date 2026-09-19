import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import { Cache, defineConfig, Envi, FileCache, ReferenceError, ValueOrigin } from "@envi/core";
// Tests against real 1Password. They need the fixture: `bun fixture:onepassword setup`.
// The service account token or the account name comes from the environment. Without both, the
// suite skips itself. With a token, no test asks for an approval.
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { onePasswordProvider, op } from "../src/index.ts";
import { expected } from "./expected.ts";
import { accountVariable, primaryVault, secondaryVault, tokenVariable } from "./fixture.ts";

const account = process.env[accountVariable];

const token = process.env[tokenVariable];

const settings = token === undefined ? { account: account ?? "" } : { serviceAccountToken: token };

const config = defineConfig({
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

const TestLayer = Layer.provideMerge(
  Layer.provide(Envi.layer(), TempFileCache),
  NodeServices.layer,
);

describe.skipIf(account === undefined && token === undefined)(
  "1Password provider against a real account",
  () => {
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

      it.effect("fails for a missing required field with the safe reference text", () =>
        Effect.gen(function* () {
          const envi = yield* Envi.Envi;

          const error = yield* envi
            .resolve(config, op(primaryVault, "app", "DOES_NOT_EXIST"))
            .pipe(Effect.provide(Layer.provide(Envi.layer(), Cache.layerNone)), Effect.flip);

          expect(error).toBeInstanceOf(ReferenceError);
          expect(error).toMatchObject({ reference: `op://${primaryVault}/app/DOES_NOT_EXIST` });
        }),
      );
    });
  },
);
