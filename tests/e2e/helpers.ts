// Shared parts of the end-to-end tests. Every test works on real files in a scoped temp folder.
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess } from "effect/unstable/process";
import { fileURLToPath } from "node:url";

export const cliPath = fileURLToPath(new URL("../../packages/envi/dist/bin.js", import.meta.url));

export const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

export const runtimes = ["node", "bun"] as const;

/** The fake secrets of the file provider. */
export const secrets = {
  "token-development": "dev-token-value",
  "token-production": "prod-token-value",
  "private-key": "-----BEGIN FAKE KEY-----\nline-one\nline-two\n-----END FAKE KEY-----",
  "public-name": "public-app-name",
  uncached: "uncached-value",
  "db-user": "app",
  "db-password": "db-pass-value",
  shared: "shared-value",
} as const;

/** Variables of the developer machine that must not reach a test run. */
const cleared = {
  CI: undefined,
  ENVI_STAGE: undefined,
  ENVI_CONFIG: undefined,
  ENVI_STRICT: undefined,
  ENVI_CACHE_DIR: undefined,
  ENVI_CACHE_ENABLED: undefined,
  ENVI_DELEGATED: undefined,
};

export interface Sandbox {
  readonly directory: string;
  readonly secretsFile: string;
  readonly callsFile: string;
  readonly cacheDirectory: string;
  /** The environment that points the file provider at this sandbox. */
  readonly env: Readonly<Record<string, string>>;
}

/** A temp folder with a secrets file, an empty call log, and a cache directory path. */
export const makeSandbox = Effect.fn("makeSandbox")(function* (encryption: "none" | "keychain") {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "envi-e2e-" });
  const secretsFile = path.join(directory, "secrets.json");
  const callsFile = path.join(directory, "calls.log");

  yield* fs.writeFileString(secretsFile, JSON.stringify(secrets));
  yield* fs.writeFileString(callsFile, "");

  const sandbox: Sandbox = {
    directory,
    secretsFile,
    callsFile,
    cacheDirectory: path.join(directory, "cache"),
    env: {
      ENVI_E2E_SECRETS_FILE: secretsFile,
      ENVI_E2E_CALLS_FILE: callsFile,
      ENVI_E2E_ENCRYPTION: encryption,
    },
  };

  return sandbox;
});

/** One entry for each provider call. Each entry holds the secret keys of that batch. */
export const providerCalls = (sandbox: Sandbox) =>
  Effect.map(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(sandbox.callsFile)),
    (text) =>
      text
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => line.split(",").toSorted()),
  );

const EntryFile = Schema.fromJsonString(
  Schema.Struct({ reference: Schema.String, encryption: Schema.String }),
);

/** The entry files of a cache directory, with the parts that hold no secret. */
export const cacheFiles = Effect.fn("cacheFiles")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const names = yield* Effect.orElseSucceed(fs.readDirectory(directory), () => []);

  return yield* Effect.forEach(
    names.filter((name) => name.endsWith(".json")),
    (name) =>
      Effect.gen(function* () {
        const file = path.join(directory, name);
        const text = yield* fs.readFileString(file);
        const entry = yield* Schema.decodeEffect(EntryFile)(text);
        const info = yield* fs.stat(file);

        return { file, text, mode: info.mode & 0o777, ...entry };
      }),
  );
});

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the built CLI to its end. */
export const runCli = Effect.fn("runCli")(function* (
  runtime: string,
  cwd: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string | undefined>> = {},
) {
  const handle = yield* ChildProcess.make(runtime, [cliPath, ...args], {
    cwd,
    env: { ...cleared, ...env },
    extendEnv: true,
  });

  const [exitCode, stdout, stderr] = yield* Effect.all(
    [
      handle.exitCode,
      Stream.mkString(Stream.decodeText(handle.stdout)),
      Stream.mkString(Stream.decodeText(handle.stderr)),
    ],
    { concurrency: "unbounded" },
  );

  const result: CliResult = { exitCode, stdout, stderr };

  return result;
});
