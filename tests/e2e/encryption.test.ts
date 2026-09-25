// The encrypted file cache across CLI processes. The key lives in the real macOS Keychain, so
// these tests run on macOS only. Each test edits real entry files the way an attacker could.
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
  type Sandbox,
  secrets,
} from "./helpers.ts";

const app = fixture("cached");

const uncachedBatch = ["uncached"];

const tokenReference = "file://token-development";

const exportJson = (runtime: string, sandbox: Sandbox) =>
  runCli(
    runtime,
    app,
    ["--cache-dir", sandbox.cacheDirectory, "export", "--format", "json"],
    sandbox.env,
  );

/** Fills the cache, and returns the entry file of the token. */
const fillCache = Effect.fn("fillCache")(function* (runtime: string, sandbox: Sandbox) {
  const first = yield* exportJson(runtime, sandbox);

  expect(first.exitCode).toBe(0);

  const files = yield* cacheFiles(sandbox.cacheDirectory);
  const token = files.find((entry) => entry.reference === tokenReference);

  return { files, token: yield* Effect.fromNullishOr(token) };
});

describe.skipIf(process.platform !== "darwin")("envi encrypted cache", () => {
  layer(NodeServices.layer, { excludeTestServices: true })((it) => {
    describe.each(runtimes)("on %s", (runtime) => {
      it.effect("writes no secret to disk, and a second process decrypts the entries", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("keychain");
          const { files } = yield* fillCache(runtime, sandbox);
          const everything = files.map((entry) => entry.text).join("\n");

          expect(files.length).toBe(7);
          expect(files.every((entry) => entry.encryption === "aes-256-gcm")).toBe(true);
          expect(files.every((entry) => entry.mode === 0o600)).toBe(true);

          for (const secret of [
            secrets["token-development"],
            secrets["db-password"],
            "line-one",
            "postgres://",
          ]) {
            expect(everything).not.toContain(secret);
          }

          const second = yield* exportJson(runtime, sandbox);

          expect(JSON.parse(second.stdout).API_TOKEN).toBe(secrets["token-development"]);
          expect(JSON.parse(second.stdout).PRIVATE_KEY).toBe(secrets["private-key"]);
          expect((yield* providerCalls(sandbox))[1]).toEqual(uncachedBatch);
        }),
      );

      it.effect("logs the duration of the Keychain read with --debug", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("keychain");

          const result = yield* runCli(
            runtime,
            app,
            ["--cache-dir", sandbox.cacheDirectory, "--debug", "check"],
            sandbox.env,
          );

          expect(result.stderr).toMatch(/step=keychain\.key durationMs=\d+ outcome=success/);
        }),
      );

      it.effect("treats an edited entry as a miss", () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const sandbox = yield* makeSandbox("keychain");
          const { token } = yield* fillCache(runtime, sandbox);
          const edited = { ...JSON.parse(token.text), resolvedAt: Date.now() + 60_000 };

          yield* fs.writeFileString(token.file, JSON.stringify(edited));

          const result = yield* exportJson(runtime, sandbox);

          expect(result.exitCode).toBe(0);
          expect(JSON.parse(result.stdout).API_TOKEN).toBe(secrets["token-development"]);
          expect((yield* providerCalls(sandbox))[1]).toEqual(["token-development", "uncached"]);
        }),
      );

      it.effect("treats an entry that someone moved to another key as a miss", () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const sandbox = yield* makeSandbox("keychain");
          const { files, token } = yield* fillCache(runtime, sandbox);

          const other = yield* Effect.fromNullishOr(
            files.find((entry) => entry.reference === "file://public-name"),
          );

          yield* fs.writeFileString(token.file, other.text);

          const result = yield* exportJson(runtime, sandbox);

          expect(JSON.parse(result.stdout).API_TOKEN).toBe(secrets["token-development"]);
          expect((yield* providerCalls(sandbox))[1]).toContain("token-development");
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

          const result = yield* exportJson(runtime, sandbox);

          expect(JSON.parse(result.stdout).API_TOKEN).toBe(secrets["token-development"]);
          expect(result.stdout).not.toContain("attacker-value");
        }),
      );

      it.effect("reads no plaintext cache of another run, and never falls back to plaintext", () =>
        Effect.gen(function* () {
          const sandbox = yield* makeSandbox("none");

          yield* exportJson(runtime, sandbox);

          const encrypted = {
            ...sandbox,
            env: { ...sandbox.env, ENVI_E2E_ENCRYPTION: "keychain" },
          };

          const result = yield* exportJson(runtime, encrypted);
          const files = yield* cacheFiles(sandbox.cacheDirectory);

          expect(result.exitCode).toBe(0);
          expect((yield* providerCalls(sandbox))[1]).toContain("token-development");
          expect(files.every((entry) => entry.encryption === "aes-256-gcm")).toBe(true);
        }),
      );
    });
  });
});
