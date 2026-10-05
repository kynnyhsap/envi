// The overrides of a client against the variables of the process. Effect copies `process.env`
// once, at the first read of the module graph of a test file, so a `vi.stubEnv` inside a test
// can come too late. This file sets the variables before any Envi call, and every test reads them.
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  createEnvi,
  defineConfig,
  Provider,
  ProviderError,
  ProviderFailure,
  VarsError,
} from "./index.ts";
import { mem, memoryProviderId } from "./testing.ts";

const variables = { CI: "false", ENVI_STRICT: "true", ENVI_INTERACTIVE: "false" };

for (const [name, value] of Object.entries(variables)) {
  vi.stubEnv(name, value);
}

const directory = mkdtempSync(join(tmpdir(), "envi-overrides-"));

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

/** A provider that records `interactive` for each batch, and fails as a whole while `down`. */
const switchable = () => {
  const state = { down: false, interactive: new Array<boolean>() };

  const source = Provider.make({
    id: memoryProviderId,
    scope: "switchable",
    resolveMany: (requests, context) =>
      Effect.suspend(() => {
        state.interactive.push(context.interactive);

        return state.down
          ? Effect.fail(
              new ProviderError({
                reason: ProviderFailure.Unavailable,
                provider: memoryProviderId,
                detail: "The test provider is down.",
              }),
            )
          : Effect.succeed(
              Object.fromEntries(requests.map((request) => [request.key, Result.succeed("1")])),
            );
      }),
    helpers: {},
  });

  return { state, oneConfig: defineConfig({ providers: [source], vars: { A: mem("a") } }) };
};

describe("the overrides of a client", () => {
  it("win over ENVI_INTERACTIVE, which decides without an override", async () => {
    const byVariable = switchable();
    const byOption = switchable();
    const plain = createEnvi(byVariable.oneConfig, { cache: false });
    const overridden = createEnvi(byOption.oneConfig, { cache: false, interactive: true });

    await plain.load();
    await overridden.load();
    await plain.dispose();
    await overridden.dispose();

    expect(byVariable.state.interactive).toEqual([false]);
    expect(byOption.state.interactive).toEqual([true]);
  });

  it("win over ENVI_STRICT for the stale fallback, which ENVI_STRICT turns off", async () => {
    const { state, oneConfig } = switchable();
    // With a ttl of 0, every entry has expired at the next load.
    const cache = { directory, encryption: "none", ttl: 0 } as const;
    const plain = createEnvi(oneConfig, { cache });
    const lenient = createEnvi(oneConfig, { cache, strict: false });

    await lenient.load();
    state.down = true;

    await expect(plain.load()).rejects.toBeInstanceOf(VarsError);
    expect(await lenient.load()).toEqual({ A: "1" });
    await plain.dispose();
    await lenient.dispose();
  });
});
