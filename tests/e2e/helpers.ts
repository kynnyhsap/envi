// Shared parts of the end-to-end tests. Every test works on real files in a scoped temp folder.
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { fileURLToPath } from "node:url";

import enviPackage from "../../packages/envi/package.json" with { type: "json" };
import { capture } from "../../scripts/Workspace.ts";

/** The version of the local `envi`. `envi --version` prints it. */
export const enviVersion = enviPackage.version;

export const cliPath = fileURLToPath(new URL("../../packages/envi/dist/bin.js", import.meta.url));

export const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

export const runtimes = ["node", "bun"] as const;

/** The README link of an error section, as the `docs` field of the error shows it. */
export const docsOf = (section: string): string =>
  `https://github.com/kynnyhsap/envi#error-${section}`;

/**
 * Decodes the JSON output of a command with its schema, such as a report schema of Envi.
 * A missing or wrong field fails the test with the path of the field.
 */
export const decodeJson = <S extends Schema.Top>(schema: S, text: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text);

/** The output of `export --format json`: each var and its raw value. */
export const ExportedVars = Schema.Record(Schema.String, Schema.String);

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

/** The secret values that a redacted output must not hold. `public-name` is not redacted. */
export const hiddenSecrets = [
  secrets["token-development"],
  secrets["db-password"],
  "line-one",
  "postgres://",
];

/**
 * Variables of the developer machine that must not reach a test run. The fixtures live in the
 * Envi repo, so the search goes up only: `repo` would find every fixture. A test of the search
 * sets its own value.
 */
export const cleared = {
  CI: undefined,
  ENVI_STAGE: undefined,
  ENVI_CONFIG: undefined,
  ENVI_CONFIG_SEARCH: "up",
  ENVI_STRICT: undefined,
  ENVI_INTERACTIVE: undefined,
  ENVI_CACHE_DIR: undefined,
  ENVI_CACHE_ENABLED: undefined,
  ENVI_CACHE_KEY: undefined,
  ENVI_DELEGATED: undefined,
};

export interface Sandbox {
  readonly directory: string;
  readonly secretsFile: string;
  readonly callsFile: string;
  readonly interactiveFile: string;
  readonly cacheDirectory: string;
  /** The environment that points the file provider at this sandbox. */
  readonly env: Readonly<Record<string, string>>;
}

/** A temp folder with a secrets file, two empty batch logs, and a cache directory path. */
export const makeSandbox = Effect.fn("makeSandbox")(function* (encryption: "none" | "keychain") {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "envi-e2e-" });
  const secretsFile = path.join(directory, "secrets.json");
  const callsFile = path.join(directory, "calls.log");
  const interactiveFile = path.join(directory, "interactive.log");

  yield* fs.writeFileString(secretsFile, JSON.stringify(secrets));
  yield* fs.writeFileString(callsFile, "");
  yield* fs.writeFileString(interactiveFile, "");

  const sandbox: Sandbox = {
    directory,
    secretsFile,
    callsFile,
    interactiveFile,
    cacheDirectory: path.join(directory, "cache"),
    env: {
      ENVI_E2E_SECRETS_FILE: secretsFile,
      ENVI_E2E_CALLS_FILE: callsFile,
      ENVI_E2E_INTERACTIVE_FILE: interactiveFile,
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

/** The `interactive` value of each provider call. */
export const providerInteractive = (sandbox: Sandbox) =>
  Effect.map(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(sandbox.interactiveFile)),
    (text) =>
      text
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => line === "true"),
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

const PlainEntryFile = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json));

/**
 * Moves the time of each plaintext entry back by `age`, as if a process wrote the entries
 * earlier. A plaintext entry binds nothing, so the edit keeps it valid.
 */
export const ageCache = Effect.fn("ageCache")(function* (directory: string, age: Duration.Input) {
  const fs = yield* FileSystem.FileSystem;

  for (const entry of yield* cacheFiles(directory)) {
    const fields = yield* Schema.decodeEffect(PlainEntryFile)(entry.text);
    const resolvedAt = yield* Schema.decodeUnknownEffect(Schema.Number)(fields["resolvedAt"]);

    yield* fs.writeFileString(
      entry.file,
      JSON.stringify({ ...fields, resolvedAt: resolvedAt - Duration.toMillis(age) }),
    );
  }
});

/** Runs a command to its end. The variables of `cleared` do not reach it. */
export const runProcess = (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = {},
) => capture(command, args, cwd, { ...cleared, ...env });

/** Runs the built CLI to its end. */
export const runCli = (
  runtime: string,
  cwd: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string | undefined>> = {},
) => runProcess(runtime, [cliPath, ...args], cwd, env);

/** Runs `export --format json` of a config on the cache of the sandbox. */
export const exportJson = (
  runtime: string,
  cwd: string,
  sandbox: Sandbox,
  env: Readonly<Record<string, string>> = {},
  flags: ReadonlyArray<string> = [],
) =>
  runCli(
    runtime,
    cwd,
    ["export", "--cache-dir", sandbox.cacheDirectory, "--format", "json", ...flags],
    { ...sandbox.env, ...env },
  );

/** Makes a folder a git repository, so that the config search follows its ignore rules. */
export const gitInit = (cwd: string) => runProcess("git", ["init", "--quiet"], cwd);
