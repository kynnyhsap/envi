import { Cache, Envi, ExportFormat, layer, ReferenceFailure } from "@kynnyhsap/envi";
import { mem, memoryProvider } from "@kynnyhsap/envi/testing";
// The Effect API. Every operation is an Effect on the `Envi` service. The plain client only runs
// these Effects. The service takes the config as an argument, because a service cannot carry a
// type parameter.
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { assertType, type Equal } from "./assert.ts";
import config from "./config-staged.ts";

const program = Effect.gen(function* () {
  const envi = yield* Envi.Envi;
  const env = yield* envi.load(config, { stage: "production" });

  assertType<Equal<typeof env.PORT, number>>();

  // A failure is a tagged error with a reason code. It never holds a secret value.
  const token = yield* envi
    .resolve(config, mem("token"))
    .pipe(
      Effect.catchTag("SecretReferenceError", (error) =>
        error.reason === ReferenceFailure.NotFound
          ? Effect.succeed("fallback")
          : Effect.fail(error),
      ),
    );

  // `sync` takes one config or a list. `check` and `sync` report each failed var.
  const report = yield* envi.sync([config]);
  const dotenv = yield* envi.export(config, ExportFormat.Dotenv, { redact: true });

  return { env, token, report, dotenv };
});

// The default composition on Node or Bun: the encrypted file cache with its key from
// `ENVI_CACHE_KEY` or the OS keychain, the environment and the signals of the process. `createEnvi` runs on the same layer.
// The service serves any config, so the layer takes the cache settings as an option.
export const live = program.pipe(Effect.provide(layer({ strict: true })));

// A test: the in-memory cache, and an in-memory provider in place of the providers of the config.
export const test = program.pipe(
  Effect.provide(
    Layer.provide(
      Envi.layer({ providers: [memoryProvider({ token: "fake" })] }),
      Cache.layerMemory,
    ),
  ),
);
