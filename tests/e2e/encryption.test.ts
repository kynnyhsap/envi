// The encrypted file cache across CLI processes. The key comes from `ENVI_CACHE_KEY`, so a local
// run never reads the keychain of the developer. With `ENVI_E2E_KEYCHAIN`, the first test also runs
// on the real keychain: CI sets it on macOS and in the Linux image with the Secret Service. A test
// edits real entry files the way an attacker could. `FileCache.test.ts` covers an edited entry
// and a moved entry.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  cacheFiles,
  decodeJson,
  ExportedVars,
  exportJson,
  fixture,
  hiddenSecrets,
  makeSandbox,
  providerCalls,
  runtimes,
  type Sandbox,
  secrets,
} from "./helpers.ts";

const app = fixture("cached");

const uncachedBatch = ["uncached"];

const tokenReference = "file://token-development";

/** The key of every run that does not test the keychain. */
const cacheKey = { ENVI_CACHE_KEY: "an e2e key" };

/** Fills the cache, and returns the entry file of the token. */
const fillCache = Effect.fn("fillCache")(function* (
  runtime: string,
  sandbox: Sandbox,
  env: Readonly<Record<string, string>> = cacheKey,
) {
  const first = yield* exportJson(runtime, app, sandbox, env);

  expect(first.exitCode).toBe(0);

  const files = yield* cacheFiles(sandbox.cacheDirectory);
  const token = files.find((entry) => entry.reference === tokenReference);

  return { files, token: yield* Effect.fromNullishOr(token) };
});

/** The sources of the key. The real keychain runs only where the environment asks for it. */
const keySources = [
  { name: "ENVI_CACHE_KEY", env: cacheKey, enabled: true },
  { name: "the keychain", env: {}, enabled: (process.env["ENVI_E2E_KEYCHAIN"] ?? "") !== "" },
];

describe("envi encrypted cache", () => {
  layer(NodeServices.layer, { excludeTestServices: true })((it) => {
    describe.each(runtimes)("on %s", (runtime) => {
      it.effect.each(keySources.filter((source) => source.enabled))(
        "writes no secret to disk, and a second process decrypts the entries with $name",
        (source) =>
          Effect.gen(function* () {
            const sandbox = yield* makeSandbox("keychain");
            const { files } = yield* fillCache(runtime, sandbox, source.env);
            const everything = files.map((entry) => entry.text).join("\n");

            expect(files.length).toBe(7);
            expect(files.every((entry) => entry.encryption === "aes-256-gcm")).toBe(true);
            expect(files.every((entry) => entry.mode === 0o600)).toBe(true);

            for (const secret of hiddenSecrets) {
              expect(everything).not.toContain(secret);
            }

            const second = yield* exportJson(runtime, app, sandbox, source.env);

            expect(yield* decodeJson(ExportedVars, second.stdout)).toMatchObject({
              API_TOKEN: secrets["token-development"],
              PRIVATE_KEY: secrets["private-key"],
            });
            expect((yield* providerCalls(sandbox))[1]).toEqual(uncachedBatch);
          }),
      );

      it.effect("ignores a plaintext entry that replaces an encrypted entry", () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const sandbox = yield* makeSandbox("keychain");
          const { token } = yield* fillCache(runtime, sandbox);
          const { iv: _iv, ciphertext: _ciphertext, ...metadata } = JSON.parse(token.text);

          yield* fs.writeFileString(
            token.file,
            JSON.stringify({ ...metadata, encryption: "none", value: "attacker-value" }),
          );

          const result = yield* exportJson(runtime, app, sandbox, cacheKey);

          expect(yield* decodeJson(ExportedVars, result.stdout)).toHaveProperty(
            "API_TOKEN",
            secrets["token-development"],
          );
          expect(result.stdout).not.toContain("attacker-value");
        }),
      );

      it.effect("reads no plaintext cache of another run, and never falls back to plaintext", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");

          yield* exportJson(runtime, app, sandbox);

          const encrypted = {
            ...sandbox,
            env: { ...sandbox.env, ENVI_E2E_ENCRYPTION: "keychain" },
          };

          const result = yield* exportJson(runtime, app, encrypted, cacheKey);
          const files = yield* cacheFiles(sandbox.cacheDirectory);

          expect(result.exitCode).toBe(0);
          expect((yield* providerCalls(sandbox))[1]).toContain("token-development");
          expect(files.every((entry) => entry.encryption === "aes-256-gcm")).toBe(true);
        }),
      );
    });
  });
});
