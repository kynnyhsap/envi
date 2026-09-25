// A custom provider for the end-to-end tests. It reads fake secrets from a real JSON file and
// appends the keys of each batch to a real log file. A test sees each provider call across
// several CLI processes this way. Both paths come from the environment of the test.
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Provider, ProviderError, ProviderFailure, reference, ReferenceFailure } from "envi";
import { appendFileSync, readFileSync } from "node:fs";

export const fileProviderId = "file";

export const secretsVariable = "ENVI_E2E_SECRETS_FILE";

export const callsVariable = "ENVI_E2E_CALLS_FILE";

const Secrets = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

/** The descriptor helper of the file provider. */
export const file = (key: string) => reference(fileProviderId, key);

/** A missing or a broken secrets file counts as a provider that is not reachable. */
const unavailable = () =>
  new ProviderError({
    reason: ProviderFailure.Unavailable,
    provider: fileProviderId,
    detail: "The secrets file does not read.",
  });

export const fileProvider = Provider.make({
  id: fileProviderId,
  Reference: Schema.String,
  describe: (key) => `file://${key}`,
  // Each secrets file is its own source of values.
  scope: Effect.sync(() => process.env[secretsVariable] ?? ""),
  resolveMany: (requests) =>
    Effect.gen(function* () {
      const text = yield* Effect.try({
        try: () => {
          appendFileSync(
            process.env[callsVariable] ?? "",
            `${requests.map((request) => request.reference).join(",")}\n`,
          );

          return readFileSync(process.env[secretsVariable] ?? "", "utf8");
        },
        catch: unavailable,
      });

      const secrets = yield* Effect.mapError(Schema.decodeEffect(Secrets)(text), unavailable);

      return Object.fromEntries(
        requests.map((request) => {
          const secret = secrets[request.reference];

          return [
            request.key,
            secret === undefined ? Result.fail(ReferenceFailure.NotFound) : Result.succeed(secret),
          ];
        }),
      );
    }),
  helpers: { file },
});
