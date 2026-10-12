// `envi export --format github`: the mask commands on stdout, the vars in the file of
// `$GITHUB_ENV`, and the failures that write nothing.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  docsOf,
  fixture,
  makeSandbox,
  providerCalls,
  runCli,
  runtimes,
  type Sandbox,
  secrets,
} from "./helpers.ts";

const app = fixture("cached");

/** The fake secrets, with the values that a workflow command must escape. */
const values = {
  ...secrets,
  // A CRLF line end, as a file from Windows has.
  "token-development": "crlf-one\r\ncrlf-two",
  // A `%`, and a text that looks like an escape, so a missing escape masks another string.
  "db-password": "50%off%0A",
};

/** The value of each secret var of the stage development, as `vars` of the fixture builds it. */
const secretVars = {
  API_TOKEN: values["token-development"],
  PRIVATE_KEY: values["private-key"],
  WITH_DEFAULT: "fallback",
  UNCACHED: values.uncached,
  DATABASE_URL: `postgres://${values["db-user"]}:${values["db-password"]}@db.invalid/app`,
};

/** The text that the file of `$GITHUB_ENV` holds before the step. An earlier step wrote it. */
const earlierStep = "EARLIER=kept\n";

const maskCommand = "::add-mask::";

/** The data of a workflow command, as the runner reads it. */
const unescapeData = (data: string) =>
  data.replaceAll("%0D", "\r").replaceAll("%0A", "\n").replaceAll("%25", "%");

/** The strings that the mask commands on stdout register. */
const masksOf = (stdout: string) =>
  stdout
    .split("\n")
    .filter((line) => line.startsWith(maskCommand))
    .map((line) => unescapeData(line.slice(maskCommand.length)));

/** One `NAME<<DELIMITER` block of the file of `$GITHUB_ENV`. The runner drops the last line end. */
const block = /(\w+)<<(\S+)\n([\s\S]*?)\n\2\n/gu;

/** The vars that the step adds to the file of `$GITHUB_ENV`, as the runner reads them. */
const addedVars = (text: string) => {
  expect(text.startsWith(earlierStep)).toBe(true);

  const added = text.slice(earlierStep.length);
  const blocks = [...added.matchAll(block)];

  expect(blocks.map(([whole]) => whole).join("")).toBe(added);

  return Object.fromEntries(blocks.map(([, name, , value]) => [name, value]));
};

/** A sandbox with the escaped values, and a file of `$GITHUB_ENV` from an earlier step. */
const githubSandbox = Effect.fn("githubSandbox")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sandbox = yield* makeSandbox("none");
  const envFile = path.join(sandbox.directory, "github-env");

  yield* fs.writeFileString(sandbox.secretsFile, JSON.stringify(values));
  yield* fs.writeFileString(envFile, earlierStep);

  return { sandbox, envFile };
});

const exportGithub = (
  runtime: string,
  sandbox: Sandbox,
  env: Readonly<Record<string, string>>,
  flags: ReadonlyArray<string> = [],
) =>
  runCli(
    runtime,
    app,
    ["export", "--cache-dir", sandbox.cacheDirectory, "--format", "github", ...flags],
    { ...sandbox.env, ...env },
  );

const readFile = (file: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(file));

layer(NodeServices.layer, { excludeTestServices: true })("envi export --format github", (it) => {
  describe.each(runtimes)("on %s", (runtime) => {
    it.effect("masks each line of a value with a newline, and keeps the value", () =>
      Effect.gen(function* () {
        const { sandbox, envFile } = yield* githubSandbox();
        const result = yield* exportGithub(runtime, sandbox, { GITHUB_ENV: envFile });
        const masks = masksOf(result.stdout);

        expect(result.exitCode).toBe(0);

        for (const line of secretVars.PRIVATE_KEY.split("\n")) {
          expect(masks).toContain(line);
        }

        expect(addedVars(yield* readFile(envFile))["PRIVATE_KEY"]).toBe(secretVars.PRIVATE_KEY);
      }),
    );

    it.effect("masks a value with % as it is, and keeps the value", () =>
      Effect.gen(function* () {
        const { sandbox, envFile } = yield* githubSandbox();
        const result = yield* exportGithub(runtime, sandbox, { GITHUB_ENV: envFile });

        expect(result.exitCode).toBe(0);
        expect(masksOf(result.stdout)).toContain(secretVars.DATABASE_URL);
        expect(addedVars(yield* readFile(envFile))["DATABASE_URL"]).toBe(secretVars.DATABASE_URL);
      }),
    );

    it.effect("masks each line of a value with CRLF line ends, and keeps the CRLF", () =>
      Effect.gen(function* () {
        const { sandbox, envFile } = yield* githubSandbox();
        const result = yield* exportGithub(runtime, sandbox, { GITHUB_ENV: envFile });
        const masks = masksOf(result.stdout);

        expect(result.exitCode).toBe(0);

        for (const line of secretVars.API_TOKEN.split("\r\n")) {
          expect(masks).toContain(line);
        }

        expect(addedVars(yield* readFile(envFile))["API_TOKEN"]).toBe(secretVars.API_TOKEN);
      }),
    );

    it.effect("prints only mask commands, and masks the secrets that it does not export", () =>
      Effect.gen(function* () {
        const { sandbox, envFile } = yield* githubSandbox();

        const result = yield* exportGithub(runtime, sandbox, { GITHUB_ENV: envFile }, [
          "--only",
          "PORT",
          "--only",
          "API_TOKEN",
        ]);

        const lines = result.stdout.split("\n").filter((line) => line !== "");
        const secretLines = Object.values(secretVars).flatMap((value) => value.split(/\r?\n/u));

        expect(result.exitCode).toBe(0);
        expect(lines.every((line) => line.startsWith(maskCommand))).toBe(true);
        expect(masksOf(result.stdout).toSorted()).toEqual([...new Set(secretLines)].toSorted());

        expect(addedVars(yield* readFile(envFile))).toEqual({
          PORT: "3000",
          API_TOKEN: secretVars.API_TOKEN,
        });
      }),
    );

    it.effect("fails for an --only name that the stage does not declare, and writes nothing", () =>
      Effect.gen(function* () {
        const { sandbox, envFile } = yield* githubSandbox();
        const valid = ["--only", "API_TOKEN"];

        const result = yield* exportGithub(runtime, sandbox, { GITHUB_ENV: envFile }, [
          ...valid,
          "--only",
          "MISSING_VAR",
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("MISSING_VAR");
        expect(result.stderr).toContain(`docs: ${docsOf("unknown-var")}`);
        expect(result.stdout).toBe("");
        expect(yield* readFile(envFile)).toBe(earlierStep);
        expect(yield* providerCalls(sandbox)).toEqual([]);

        const allowed = yield* exportGithub(runtime, sandbox, { GITHUB_ENV: envFile }, valid);

        expect(allowed.exitCode).toBe(0);
        expect(Object.keys(addedVars(yield* readFile(envFile)))).toEqual(["API_TOKEN"]);
      }),
    );

    it.effect("fails without GITHUB_ENV, and writes nothing", () =>
      Effect.gen(function* () {
        const { sandbox, envFile } = yield* githubSandbox();
        const result = yield* exportGithub(runtime, sandbox, {});

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("NoGithubEnv");
        expect(result.stderr).toContain(`docs: ${docsOf("export-file-no-github-env")}`);
        expect(result.stdout).toBe("");
        expect(yield* providerCalls(sandbox)).toEqual([]);

        const allowed = yield* exportGithub(runtime, sandbox, { GITHUB_ENV: envFile });

        expect(allowed.exitCode).toBe(0);
        expect(addedVars(yield* readFile(envFile))).toHaveProperty("API_TOKEN");
      }),
    );

    it.effect("rejects --output, because the vars go to the file of GITHUB_ENV", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const { sandbox, envFile } = yield* githubSandbox();
        const output = path.join(sandbox.directory, "out.env");

        const result = yield* exportGithub(runtime, sandbox, { GITHUB_ENV: envFile }, [
          "--output",
          output,
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(`docs: ${docsOf("settings")}`);
        expect(result.stdout).toBe("");
        expect(yield* fs.exists(output)).toBe(false);
        expect(yield* readFile(envFile)).toBe(earlierStep);
        expect(yield* providerCalls(sandbox)).toEqual([]);

        const allowed = yield* exportGithub(runtime, sandbox, { GITHUB_ENV: envFile });

        expect(allowed.exitCode).toBe(0);
        expect(addedVars(yield* readFile(envFile))).toHaveProperty("API_TOKEN");
      }),
    );
  });
});
