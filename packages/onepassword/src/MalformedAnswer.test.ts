// A malformed answer of the 1Password SDK can hold a secret. Envi must fail with InvalidResponse
// and keep the secret out of the error and the debug logs, and the same config must resolve once
// the answer is valid. The test runs the public Effect layer with debug logs on.
import { describe, expect, it } from "@effect/vitest";
import {
  defineConfig,
  Envi,
  layer,
  ProviderError,
  ProviderFailure,
  VarsError,
} from "@kynnyhsap/envi";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import type * as Schema from "effect/Schema";

import { makeProvider } from "./Provider.ts";
import type { Sdk } from "./Sdk.ts";

const sentinel = "fake-secret-sentinel";

const reference = "op://app/postgres/url";

const validValue = "postgres://fake";

class FakeDesktopAuth {
  readonly accountName: string;

  constructor(accountName: string) {
    this.accountName = accountName;
  }
}

/** An SDK whose `resolveAll` gives the answer, whatever its form. */
const sdkAnswering = (answer: Schema.Json): Sdk<FakeDesktopAuth> => ({
  DesktopAuth: FakeDesktopAuth,
  AuthExpiredError: class extends Error {},
  DesktopSessionExpiredError: class extends Error {},
  RateLimitExceededError: class extends Error {},
  createClient: () => Promise.resolve({ secrets: { resolveAll: () => Promise.resolve(answer) } }),
});

const configOf = (answer: Schema.Json) =>
  defineConfig({
    stages: ["development"],
    providers: [
      makeProvider({ serviceAccountToken: "ops_fake" }, Effect.succeed(sdkAnswering(answer))),
    ],
    vars: ({ op }) => ({ DATABASE_URL: op(reference) }),
  });

/** Loads the config through the public Effect layer. */
const load = (answer: Schema.Json) =>
  Envi.Envi.use((envi) => envi.loadRaw(configOf(answer))).pipe(
    Effect.provide(layer({ cache: false, interactive: false })),
  );

/** Runs an effect with debug logs on, and returns its result and every log line. */
const withDebugLogs = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const lines: Array<string> = [];
    const logger = Logger.map(Logger.formatJson, (line) => void lines.push(line));

    const result = yield* effect.pipe(
      Effect.provide(Logger.layer([logger])),
      Effect.provideService(References.MinimumLogLevel, "Debug"),
    );

    return { result, logs: lines.join("\n") };
  });

const malformedAnswers: ReadonlyArray<readonly [string, Schema.Json]> = [
  [
    "a secret of another type",
    { individualResponses: { [reference]: { content: { secret: [sentinel] } } } },
  ],
  [
    "content that is not an object",
    { individualResponses: { [reference]: { content: sentinel } } },
  ],
  [
    "an error type that is not a string",
    { individualResponses: { [reference]: { error: { type: [sentinel] } } } },
  ],
  [
    "no answer for the reference",
    { individualResponses: { "op://app/other/key": { content: { secret: sentinel } } } },
  ],
  ["responses that are not a record", { individualResponses: sentinel }],
  ["an answer that is not an object", sentinel],
];

describe("a malformed answer of the 1Password SDK", () => {
  it.effect.each(malformedAnswers)(
    "fails with InvalidResponse and keeps the secret out of the error and the logs: %s",
    ([, answer]) =>
      Effect.gen(function* () {
        const { result: error, logs } = yield* withDebugLogs(Effect.flip(load(answer)));
        const failures = error instanceof VarsError ? error.failures : [];

        expect(error).toBeInstanceOf(VarsError);
        expect(failures.map(({ key }) => key)).toEqual(["DATABASE_URL"]);
        expect(failures[0]?.error).toBeInstanceOf(ProviderError);
        expect(failures[0]?.error).toMatchObject({ reason: ProviderFailure.InvalidResponse });
        expect(JSON.stringify(error)).not.toContain(sentinel);
        expect(String(error)).not.toContain(sentinel);
        expect(logs).not.toContain(sentinel);
      }),
  );

  it.effect("resolves the same config once the answer is valid", () =>
    Effect.gen(function* () {
      const { result } = yield* withDebugLogs(
        load({
          individualResponses: { [reference]: { content: { secret: validValue }, error: null } },
        }),
      );

      expect(result).toEqual({ DATABASE_URL: validValue });
    }),
  );
});
