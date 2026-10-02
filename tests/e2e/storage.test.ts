// One `sync` of several configs fills one cache. Every config that uses the cache must select the
// same encryption and the same directory, or the sync writes nothing. The key comes from
// `ENVI_CACHE_KEY`, and `HOME` is the sandbox, so no test reads the real keychain or cache.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import { ErrorReport } from "@kynnyhsap/envi";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { fileURLToPath } from "node:url";

import {
  cacheFiles,
  decodeJson,
  docsOf,
  fixture,
  makeSandbox,
  providerCalls,
  runCli,
  runtimes,
  type Sandbox,
} from "./helpers.ts";

const repoModules = fileURLToPath(new URL("../../node_modules", import.meta.url));

/** The file provider and the modules of the repo in the sandbox, for the configs below. */
const prepare = Effect.fn("prepare")(function* (sandbox: Sandbox) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* fs.writeFileString(path.join(sandbox.directory, "package.json"), '{"type":"module"}');
  yield* fs.copyFile(fixture("file-provider.ts"), path.join(sandbox.directory, "file-provider.ts"));
  yield* fs.symlink(repoModules, path.join(sandbox.directory, "node_modules"));
});

/**
 * Writes the config of the folder `name` with one secret and the `cache` key. `provider` is the
 * code of its provider: a copy of the file provider puts the config into a group of its own.
 */
const writeConfig = Effect.fn("writeConfig")(function* (
  sandbox: Sandbox,
  name: string,
  secret: string,
  cache: false | Readonly<Record<string, string>>,
  provider = "fileProvider",
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = path.join(sandbox.directory, name);
  const file = path.join(folder, "envi.config.ts");

  yield* fs.makeDirectory(folder, { recursive: true });

  yield* fs.writeFileString(
    file,
    [
      'import { defineConfig } from "@kynnyhsap/envi";',
      'import { fileProvider } from "../file-provider.ts";',
      "export default defineConfig({",
      `  providers: [${provider}],`,
      `  cache: ${JSON.stringify(cache)},`,
      `  vars: ({ file }) => ({ TOKEN: file(${JSON.stringify(secret)}) }),`,
      "});",
    ].join("\n"),
  );

  return file;
});

const syncArgs = (configs: ReadonlyArray<string>, flags: ReadonlyArray<string> = []) => [
  "sync",
  ...configs.flatMap((config) => ["--config", config]),
  ...flags,
  "--json",
];

layer(NodeServices.layer, { excludeTestServices: true })("envi sync of several configs", (it) => {
  describe.each(runtimes)("on %s", (runtime) => {
    it.effect("rejects configs that select another encryption, and writes nothing", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const env = { ...sandbox.env, HOME: sandbox.directory, ENVI_CACHE_KEY: "an e2e key" };
        const cacheDir = ["--cache-dir", sandbox.cacheDirectory];

        yield* prepare(sandbox);

        const plaintext = yield* writeConfig(sandbox, "plaintext", "token-development", {
          encryption: "none",
        });

        const encrypted = yield* writeConfig(sandbox, "encrypted", "db-password", {});

        const rejected = yield* Effect.forEach(
          [
            [plaintext, encrypted],
            [encrypted, plaintext],
          ],
          (configs) => runCli(runtime, sandbox.directory, syncArgs(configs, cacheDir), env),
        );

        for (const result of rejected) {
          expect(result.exitCode).toBe(1);
          expect((yield* decodeJson(ErrorReport, result.stdout)).error).toMatchObject({
            error: "SettingsError",
            docs: docsOf("settings"),
          });
        }

        expect(yield* cacheFiles(sandbox.cacheDirectory)).toEqual([]);
        expect(yield* providerCalls(sandbox)).toEqual([]);

        yield* writeConfig(sandbox, "plaintext", "token-development", {});

        const synced = yield* runCli(
          runtime,
          sandbox.directory,
          syncArgs([plaintext, encrypted], cacheDir),
          env,
        );

        const files = yield* cacheFiles(sandbox.cacheDirectory);

        expect(synced.exitCode).toBe(0);
        expect(files.map((entry) => entry.encryption)).toEqual(["aes-256-gcm", "aes-256-gcm"]);
      }),
    );

    it.effect("rejects configs that select another directory, unless --cache-dir selects one", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const sandbox = yield* makeSandbox("none");
        const env = { ...sandbox.env, HOME: sandbox.directory };
        const own = path.join(sandbox.directory, "own-cache");

        yield* prepare(sandbox);

        const configs = [
          yield* writeConfig(sandbox, "own", "token-development", {
            encryption: "none",
            directory: own,
          }),
          yield* writeConfig(sandbox, "default", "db-password", { encryption: "none" }),
        ];

        const rejected = yield* runCli(runtime, sandbox.directory, syncArgs(configs), env);

        expect(rejected.exitCode).toBe(1);
        expect((yield* decodeJson(ErrorReport, rejected.stdout)).error).toMatchObject({
          error: "SettingsError",
          docs: docsOf("settings"),
        });
        expect(yield* cacheFiles(own)).toEqual([]);
        expect(yield* cacheFiles(path.join(sandbox.directory, ".cache", "envi"))).toEqual([]);
        expect(yield* providerCalls(sandbox)).toEqual([]);

        const synced = yield* runCli(
          runtime,
          sandbox.directory,
          syncArgs(configs, ["--cache-dir", sandbox.cacheDirectory]),
          env,
        );

        expect(synced.exitCode).toBe(0);
        expect((yield* cacheFiles(sandbox.cacheDirectory)).length).toBe(configs.length);
      }),
    );

    it.effect("caches the configs that use the cache when the first config turns it off", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const cached = "token-development";

        yield* prepare(sandbox);

        const configs = [
          yield* writeConfig(sandbox, "off", "db-password", false, "{ ...fileProvider }"),
          yield* writeConfig(sandbox, "cached", cached, { encryption: "none" }),
        ];

        const result = yield* runCli(
          runtime,
          sandbox.directory,
          syncArgs(configs, ["--cache-dir", sandbox.cacheDirectory]),
          { ...sandbox.env, HOME: sandbox.directory },
        );

        const files = yield* cacheFiles(sandbox.cacheDirectory);

        expect(result.exitCode).toBe(0);
        expect(files.map((entry) => entry.reference)).toEqual([`file://${cached}`]);
      }),
    );
  });
});
