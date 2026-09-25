// The key of the encrypted cache: `ENVI_CACHE_KEY`, and a system without a keychain. The Linux
// image without a keychain sets `ENVI_E2E_NO_KEYCHAIN`. `bun run test:linux` runs that image.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  cacheFiles,
  fixture,
  makeSandbox,
  providerCalls,
  runCli,
  runtimes,
  type Sandbox,
} from "./helpers.ts";

const app = fixture("cached");

const exportJson = (
  runtime: string,
  sandbox: Sandbox,
  env: Readonly<Record<string, string>> = {},
  flags: ReadonlyArray<string> = [],
) =>
  runCli(
    runtime,
    app,
    ["export", "--cache-dir", sandbox.cacheDirectory, "--format", "json", ...flags],
    { ...sandbox.env, ...env },
  );

layer(NodeServices.layer, { excludeTestServices: true })("envi cache key", (it) => {
  describe.each(runtimes)("on %s", (runtime) => {
    it.effect("encrypts the cache with ENVI_CACHE_KEY, and another key cannot read it", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("keychain");
        const key = { ENVI_CACHE_KEY: "a key from the secrets of the CI system" };

        const first = yield* exportJson(runtime, sandbox, key, ["--debug"]);
        const second = yield* exportJson(runtime, sandbox, key);
        const other = yield* exportJson(runtime, sandbox, { ENVI_CACHE_KEY: "another key" });
        const files = yield* cacheFiles(sandbox.cacheDirectory);

        expect(first.exitCode).toBe(0);
        expect(first.stderr).toMatch(/step=keychain\.key durationMs=\d+ outcome=success/);
        expect(files.length).toBe(7);
        expect(files.every((entry) => entry.encryption === "aes-256-gcm")).toBe(true);
        expect(second.stdout).toBe(first.stdout);
        expect(other.stdout).toBe(first.stdout);

        // The second run reads the cache. The run with another key misses every entry.
        const calls = yield* providerCalls(sandbox);

        expect(calls[1]).toEqual(["uncached"]);
        expect(calls[2]?.length).toBeGreaterThan(1);
      }),
    );

    describe.skipIf(process.env["ENVI_E2E_NO_KEYCHAIN"] === undefined)("without a keychain", () => {
      it.effect("warns once and runs without a cache, and --cache fails", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("keychain");
          const fallback = yield* exportJson(runtime, sandbox);
          const forced = yield* exportJson(runtime, sandbox, {}, ["--cache"]);

          expect(fallback.exitCode).toBe(0);
          expect(fallback.stderr.match(/Envi runs without a cache/gu)?.length).toBe(1);
          expect(fallback.stderr).toContain("ENVI_CACHE_KEY");
          expect(yield* cacheFiles(sandbox.cacheDirectory)).toEqual([]);
          expect(forced.exitCode).toBe(1);
          expect(forced.stderr).toContain("KeyUnavailable");
        }),
      );
    });
  });
});
