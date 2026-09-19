// A custom provider. The provider interface is public and unstable until a second real provider
// proves it.
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { createEnvi, defineConfig, Provider, reference, ReferenceFailure } from "envi";

import { assertType, type Equal } from "./assert.ts";

declare const readFromVault: (path: string) => Promise<string | undefined>;

const providerId = "team-vault";

/** The descriptor helper. It builds a descriptor and resolves nothing. */
const vault = (path: string) => reference(providerId, { path });

/** The five required members, plus the helpers that `vars` receives. */
export const teamVaultProvider = Provider.make({
  id: providerId,
  Reference: Schema.Struct({ path: Schema.String }),
  describe: (ref) => `team-vault://${ref.path}`,
  cacheKey: (ref) => ref.path,
  // The only resolve method: one call for the whole batch. Results are matched by request key.
  resolveMany: (requests) =>
    Effect.forEach(requests, (request) =>
      Effect.map(
        Effect.orDie(Effect.tryPromise(() => readFromVault(request.reference.path))),
        (secret) =>
          [
            request.key,
            secret === undefined ? Result.fail(ReferenceFailure.NotFound) : Result.succeed(secret),
          ] as const,
      ),
    ).pipe(Effect.map((entries) => Object.fromEntries(entries))),
  helpers: { vault },
});

const config = defineConfig({
  providers: [teamVaultProvider],
  // `vault` comes from the `helpers` of the provider. The config file needs no helper import.
  vars: ({ vault: secret }) => ({
    API_KEY: secret("services/api/key"),
    REGION: secret("services/api/region").optional(),
  }),
});

const env = await createEnvi(config).load();

assertType<Equal<typeof env.API_KEY, string>>();
assertType<Equal<typeof env.REGION, string | undefined>>();
