// SDK, Effect.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { ExportFormat, reference } from "envi";
import { onePasswordProvider, op } from "envi/1password";
import { Cache, Envi, Provider, Providers, ReferenceError } from "envi/effect";
import { memoryProvider } from "envi/memory";

import { assertType, type Equal } from "./assert.ts";
import config from "./config-staged.ts";
import staticConfig from "./config-static.ts";

// 1. Static: load a config. Failures are typed errors with reason codes.
const program = Effect.gen(function* () {
  const envi = yield* Envi;
  const env = yield* envi.load(config, { stage: "development" });

  assertType<Equal<typeof env.PORT, number>>();

  return env.DATABASE_URL.host;
});

// 2. Dynamic: one record is one batch for each provider.
const dynamic = Effect.gen(function* () {
  const envi = yield* Envi;

  return yield* envi.resolve({
    stripeKey: op("payments", "stripe", "secret-key"),
    webhookSecret: op("payments", "stripe", "webhook-secret"),
    rateLimit: op("app", "api", "rate-limit").schema(Schema.NumberFromString),
  });
});

// 2b. The CLI commands as service methods. `sync` takes one config or a list.
const commands = Effect.gen(function* () {
  const envi = yield* Envi;
  const synced = yield* envi.sync([config, staticConfig], { refresh: true });
  const checked = yield* envi.check(config, { stage: "production" });
  const dotenv = yield* envi.export(config, ExportFormat.Dotenv, { redact: true });
  const child = yield* envi.run(config, "bun", ["scripts/dev.ts"]);

  return { checked, dotenv, exitCode: child.exitCode, failures: synced.failures };
});

// 3. Recover from one error tag, by its reason code.
const withFallback = Effect.gen(function* () {
  const envi = yield* Envi;

  return yield* envi
    .resolve(op("app", "api", "flag"))
    .pipe(
      Effect.catchTag("ReferenceError", (error) =>
        error.reason === "NotFound" ? Effect.succeed("off") : Effect.fail(error),
      ),
    );
});

// 4. The default layer: the file cache with keychain encryption, and explicit providers.
const EnviLive = Envi.layer({
  providers: [onePasswordProvider({ account: "my-team" })],
}).pipe(Layer.provide(NodeServices.layer));

// 5. Feed Effect's own `Config` module. Application code then has no Envi import.
const ConfigLive = Envi.layerConfigProvider(config, { stage: "development" }).pipe(
  Layer.provide(EnviLive),
);

const app = Effect.gen(function* () {
  const databaseUrl = yield* Config.Redacted("DATABASE_URL");
  const port = yield* Config.Number("PORT");

  return { databaseUrl, port };
}).pipe(Effect.provide(ConfigLive));

// 6. A test composition: the bare core, an in-memory cache, and an in-memory provider.
const EnviTest = Envi.layerCore.pipe(
  Layer.provide(Cache.layerMemory),
  Layer.provide(Providers.layer([memoryProvider({ "db/url": "postgres://localhost/app" })])),
);

// 7. A custom cache: a layer for the `Cache` service.
const CacheCustom = Layer.succeed(Cache, {
  getMany: () => Effect.succeed({}),
  setMany: () => Effect.void,
  removeMany: () => Effect.void,
  clear: Effect.void,
  withResolveLock: (effect) => effect,
});

const EnviCustomCache = Envi.layerCore.pipe(
  Layer.provide(CacheCustom),
  Layer.provide(Providers.layer([onePasswordProvider({ account: "my-team" })])),
);

// 8. A custom provider with Effect. Results are matched by request key.
const VaultReference = Schema.Struct({ path: Schema.String, key: Schema.String });

export const vault = (path: string, key: string) => reference("hashicorp-vault", { path, key });

const hashicorpVaultProvider = Provider.make({
  id: "hashicorp-vault",
  Reference: VaultReference,
  describe: (ref) => `vault://${ref.path}#${ref.key}`,
  cacheKey: (ref) => `${ref.path}#${ref.key}`,
  resolveMany: (requests) =>
    Effect.succeed(
      Object.fromEntries(
        requests.map((request) => [
          request.key,
          request.reference.key === "missing"
            ? Result.fail(new ReferenceError({ reason: "NotFound", reference: request.key }))
            : Result.succeed("value"),
        ]),
      ),
    ),
});

const EnviWithVault = Envi.layerCore.pipe(
  Layer.provide(Cache.layerNone),
  Layer.provide(Providers.layer([hashicorpVaultProvider])),
);

// 9. Run.
program.pipe(Effect.provide(EnviLive), NodeRuntime.runMain);

export { app, commands, dynamic, EnviCustomCache, EnviTest, EnviWithVault, withFallback };
