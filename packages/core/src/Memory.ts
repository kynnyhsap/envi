import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { ReferenceFailure } from "./Errors.ts";
import * as Provider from "./Provider.ts";
import * as Source from "./Source.ts";

/** The id of the in-memory provider. */
export const memoryProviderId = "memory";

/** A descriptor for the in-memory provider. */
export const mem = (key: string): Source.Source => Source.reference(memoryProviderId, key);

/** The in-memory provider. It records each batch, so a test can assert the batch rule. */
export interface MemoryProvider extends Provider.Provider<{ readonly mem: typeof mem }> {
  /** One entry for each `resolveMany` call. Each entry holds the secret keys of that batch. */
  readonly calls: () => ReadonlyArray<ReadonlyArray<string>>;
}

/**
 * A faithful provider over a fixed record of secrets. Tests and examples use it.
 *
 * @param secrets - The secret values by key. A key that is absent resolves to `NotFound`.
 */
export const memoryProvider = (secrets: Readonly<Record<string, string>>): MemoryProvider => {
  const calls: Array<ReadonlyArray<string>> = [];

  const provider = Provider.make({
    id: memoryProviderId,
    Reference: Schema.String,
    describe: (key) => `memory://${key}`,
    // The secrets live in this instance only, so no other instance shares its cache entries.
    scope: crypto.randomUUID(),
    resolveMany: (requests) =>
      Effect.sync(() => {
        calls.push(requests.map((request) => request.reference));

        return Object.fromEntries(
          requests.map((request) => {
            const secret = secrets[request.reference];

            return [
              request.key,
              secret === undefined
                ? Result.fail(ReferenceFailure.NotFound)
                : Result.succeed(secret),
            ];
          }),
        );
      }),
    helpers: { mem },
  });

  return { ...provider, calls: () => [...calls] };
};
