// The cache across several CLI processes, with real cache files and a provider that logs each
// call to a real file.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  cacheFiles,
  fixture,
  makeSandbox,
  providerCalls,
  runCli,
  runtimes,
  secrets,
} from "./helpers.ts";

const app = fixture("cached");

/** The batch of a run on an empty cache. `absent` backs two vars and appears once. */
const fullBatch = [
  "absent",
  "db-password",
  "db-user",
  "private-key",
  "public-name",
  "token-development",
  "uncached",
];

/** The batch of a run on a full cache: only the `.cache(false)` var calls the provider again. */
const uncachedBatch = ["uncached"];

const failedKeys = (stdout: string): ReadonlyArray<string> =>
  JSON.parse(stdout).failures.map((failure: { key: string }) => failure.key);

layer(NodeServices.layer, { excludeTestServices: true })("envi cache", (it) => {
  describe.each(runtimes)("on %s", (runtime) => {
    it.effect("resolves once, and then every process reads the cache", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const args = ["--cache-dir", sandbox.cacheDirectory];
        const first = yield* runCli(runtime, app, [...args, "sync", "--json"], sandbox.env);

        expect(first.exitCode).toBe(0);
        expect(JSON.parse(first.stdout).providers).toEqual([
          { provider: "file", secrets: 7, cached: 0, resolved: 7 },
        ]);

        const second = yield* runCli(runtime, app, [...args, "check"], sandbox.env);

        expect(second.exitCode).toBe(0);
        expect(yield* providerCalls(sandbox)).toEqual([fullBatch, uncachedBatch]);

        const inspect = yield* runCli(runtime, app, [...args, "inspect", "--json"], sandbox.env);

        const vars: ReadonlyArray<{ key: string; origin: string; value: string | null }> =
          JSON.parse(inspect.stdout).vars;

        const origins = Object.fromEntries(vars.map((entry) => [entry.key, entry.origin]));

        expect(origins).toEqual({
          NODE_ENV: "literal",
          PORT: "literal",
          API_TOKEN: "cache",
          PRIVATE_KEY: "cache",
          OPTIONAL: "unset",
          WITH_DEFAULT: "default",
          PUBLIC_NAME: "cache",
          GREETING: "derived",
          UNCACHED: "provider",
          FROM_PARENT: "unset",
          DATABASE_URL: "cache",
        });
        expect(vars.find((entry) => entry.key === "GREETING")?.value).toBe(
          `hello ${secrets["public-name"]}`,
        );
      }),
    );

    it.effect("keeps a cached value until --refresh", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const sandbox = yield* makeSandbox("none");
        const args = ["--cache-dir", sandbox.cacheDirectory, "export", "--format", "json"];

        yield* runCli(runtime, app, args, sandbox.env);

        yield* fs.writeFileString(
          sandbox.secretsFile,
          JSON.stringify({ ...secrets, "token-development": "rotated-token-value" }),
        );

        const cached = yield* runCli(runtime, app, args, sandbox.env);
        const refreshed = yield* runCli(runtime, app, [...args, "--refresh"], sandbox.env);
        const afterwards = yield* runCli(runtime, app, args, sandbox.env);

        expect(JSON.parse(cached.stdout).API_TOKEN).toBe("dev-token-value");
        expect(JSON.parse(refreshed.stdout).API_TOKEN).toBe("rotated-token-value");
        expect(JSON.parse(afterwards.stdout).API_TOKEN).toBe("rotated-token-value");
      }),
    );

    it.effect("reads and writes no cache file with --no-cache", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const args = ["--cache-dir", sandbox.cacheDirectory, "--no-cache", "check"];

        yield* runCli(runtime, app, args, sandbox.env);
        yield* runCli(runtime, app, args, sandbox.env);

        expect(yield* providerCalls(sandbox)).toEqual([fullBatch, fullBatch]);
        expect(yield* cacheFiles(sandbox.cacheDirectory)).toEqual([]);
      }),
    );

    it.effect("turns the cache off in CI, and --cache turns it on again", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const args = ["--cache-dir", sandbox.cacheDirectory];
        const env = { ...sandbox.env, CI: "true" };

        yield* runCli(runtime, app, [...args, "check"], env);

        expect(yield* cacheFiles(sandbox.cacheDirectory)).toEqual([]);

        yield* runCli(runtime, app, [...args, "--cache", "check"], env);

        expect((yield* cacheFiles(sandbox.cacheDirectory)).length).toBe(7);
      }),
    );

    it.effect("writes plaintext entries only after the explicit opt-in, with private modes", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const sandbox = yield* makeSandbox("none");

        yield* runCli(runtime, app, ["--cache-dir", sandbox.cacheDirectory, "sync"], sandbox.env);

        const files = yield* cacheFiles(sandbox.cacheDirectory);
        const directory = yield* fs.stat(sandbox.cacheDirectory);

        expect(files.map((entry) => entry.reference).toSorted()).toEqual([
          "custom(database-url)",
          "file://absent",
          "file://db-password",
          "file://db-user",
          "file://private-key",
          "file://public-name",
          "file://token-development",
        ]);
        expect(files.every((entry) => entry.mode === 0o600)).toBe(true);
        expect(files.every((entry) => entry.encryption === "none")).toBe(true);
        expect(directory.mode & 0o777).toBe(0o700);
        expect(files.some((entry) => entry.text.includes("dev-token-value"))).toBe(true);
      }),
    );

    it.effect("uses an expired entry when the provider is down, except with --strict", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const sandbox = yield* makeSandbox("none");
        const env = { ...sandbox.env, ENVI_E2E_TTL: "short" };
        const args = ["--cache-dir", sandbox.cacheDirectory, "check", "--json"];

        yield* runCli(runtime, app, args, env);
        yield* Effect.sleep("1200 millis");
        yield* fs.remove(sandbox.secretsFile);

        const stale = yield* runCli(runtime, app, args, env);
        const strict = yield* runCli(runtime, app, [...args, "--strict"], env);
        const viaVariable = yield* runCli(runtime, app, args, { ...env, ENVI_STRICT: "true" });

        // A var without an entry has no fallback. A cached `NotFound` serves `.optional()` and
        // `.default()` as a stale entry too.
        expect(failedKeys(stale.stdout)).toEqual(["UNCACHED"]);
        expect(stale.stderr).toContain("expired cache entry");
        expect(stale.stderr).toContain("file://token-development");
        expect(failedKeys(strict.stdout)).toContain("API_TOKEN");
        expect(failedKeys(strict.stdout)).toContain("DATABASE_URL");
        expect(failedKeys(viaVariable.stdout)).toContain("API_TOKEN");
      }),
    );

    it.effect("resolves once when several processes start on an empty cache", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const args = ["--cache-dir", sandbox.cacheDirectory, "check"];

        const results = yield* Effect.all(
          [1, 2, 3, 4].map(() => runCli(runtime, app, args, sandbox.env)),
          { concurrency: "unbounded" },
        );

        const calls = yield* providerCalls(sandbox);

        expect(results.map((result) => result.exitCode)).toEqual([0, 0, 0, 0]);
        expect(calls.filter((batch) => batch.includes("db-user")).length).toBe(1);
        expect(calls.length).toBe(4);
      }),
    );
  });
});
