import {
  Provider,
  ProviderError,
  ProviderFailure,
  reference,
  ReferenceFailure,
} from "@kynnyhsap/envi";
// A custom provider for the end-to-end tests. It reads fake secrets from a real JSON file and
// appends the keys and the `interactive` value of each batch to real log files. A test sees each provider call across
// several CLI processes this way. Both paths come from the environment of the test. Its search
// lists the keys that hold the query.
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { appendFileSync, readFileSync } from "node:fs";

export const fileProviderId = "file";

/** The prefix of the `describe()` text of a key. */
const scheme = `${fileProviderId}://`;

export const secretsVariable = "ENVI_E2E_SECRETS_FILE";

export const callsVariable = "ENVI_E2E_CALLS_FILE";

/** The log of the `interactive` value of each batch, one line for each batch. */
export const interactiveVariable = "ENVI_E2E_INTERACTIVE_FILE";

/** A fake credential of the file provider. `run` must remove it from the child. */
export const tokenVariable = "ENVI_E2E_FILE_TOKEN";

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

/** Reads the secrets file. */
const readSecrets = Effect.try({
  try: () => readFileSync(process.env[secretsVariable] ?? "", "utf8"),
  catch: unavailable,
}).pipe(Effect.flatMap((text) => Effect.mapError(Schema.decodeEffect(Secrets)(text), unavailable)));

export const fileProvider = Provider.make({
  id: fileProviderId,
  Reference: Schema.String,
  describe: (key) => `${scheme}${key}`,
  // Each secrets file is its own source of values.
  scope: Effect.sync(() => process.env[secretsVariable] ?? ""),
  credentialVariables: [tokenVariable],
  resolveMany: (requests, context) =>
    Effect.gen(function* () {
      yield* Effect.try({
        try: () => {
          appendFileSync(
            process.env[callsVariable] ?? "",
            `${requests.map((request) => request.reference).join(",")}\n`,
          );
          appendFileSync(process.env[interactiveVariable] ?? "", `${context.interactive}\n`);
        },
        catch: unavailable,
      });

      const secrets = yield* readSecrets;

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
  // A key matches a query that it contains. A query can be the `describe()` text of a missing key.
  // The search logs no batch, because it resolves nothing.
  discover: (queries) =>
    Effect.map(readSecrets, (secrets) =>
      Object.fromEntries(
        queries.map((query) => {
          const text = query.startsWith(scheme) ? query.slice(scheme.length) : query;

          return [query, Object.keys(secrets).filter((key) => key.includes(text))];
        }),
      ),
    ),
  helpers: { file },
});
