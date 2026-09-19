// Runs the built CLI against real 1Password, on Node and on Bun. It needs the fixture:
// `bun fixture:onepassword setup`. Without a token and an account name, the suite skips itself.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";
import { ChildProcess } from "effect/unstable/process";
import { fileURLToPath } from "node:url";

import { expected } from "./expected.ts";
import { accountVariable, primaryVault, secondaryVault, tokenVariable } from "./fixture.ts";

const account = process.env[accountVariable];

const token = process.env[tokenVariable];

/** The provider variables of the CLI process. The token wins over the account name. */
const credential: Record<string, string> =
  token === undefined
    ? { ENVI_PROVIDER_ONEPASSWORD_ACCOUNT: account ?? "" }
    : { ENVI_PROVIDER_ONEPASSWORD_SERVICE_ACCOUNT_TOKEN: token };

const cliPath = fileURLToPath(new URL("../../envi/dist/bin.js", import.meta.url));

const cwd = fileURLToPath(new URL("./fixtures/app", import.meta.url));

const printVars =
  "console.log([process.env.PORT, process.env.API_TOKEN, process.env.STRIPE_KEY, Object.keys(process.env).some((name) => name.startsWith('ENVI_PROVIDER_')) ? 'leaked' : 'removed'].join('|'))";

/** Runs the built CLI. `CI` is unset, so the run behaves like a run on a developer machine. */
const runCli = Effect.fn("runCli")(function* (
  runtime: string,
  cacheDirectory: string,
  args: ReadonlyArray<string>,
) {
  const handle = yield* ChildProcess.make(
    runtime,
    [cliPath, "--cache-dir", cacheDirectory, ...args],
    { cwd, env: { CI: undefined, ENVI_STAGE: undefined, ...credential }, extendEnv: true },
  );

  const [exitCode, stdout] = yield* Effect.all(
    [handle.exitCode, Stream.mkString(Stream.decodeText(handle.stdout))],
    { concurrency: "unbounded" },
  );

  return { exitCode, stdout };
});

describe.skipIf(account === undefined && token === undefined)(
  "envi CLI against a real account",
  () => {
    layer(NodeServices.layer, { excludeTestServices: true })((it) => {
      describe.each(["node", "bun"])("on %s", (runtime) => {
        it.effect("syncs from 1Password, and then runs a child from the cache", () =>
          Effect.gen(function* () {
            const fileSystem = yield* FileSystem.FileSystem;

            const cacheDirectory = yield* fileSystem.makeTempDirectoryScoped({
              prefix: "envi-onepassword-cli-",
            });

            const apiToken = yield* expected(primaryVault, "app", "API_TOKEN");
            const stripeKey = yield* expected(secondaryVault, "payments", "STRIPE_KEY");
            const sync = yield* runCli(runtime, cacheDirectory, ["sync", "--json"]);

            expect(sync.exitCode).toBe(0);
            expect(sync.stdout).not.toContain(stripeKey);

            const child = yield* runCli(runtime, cacheDirectory, [
              "run",
              "--",
              runtime,
              "-e",
              printVars,
            ]);

            expect(child.exitCode).toBe(0);
            expect(child.stdout.trim()).toBe(
              [yield* expected(primaryVault, "app", "PORT"), apiToken, stripeKey, "removed"].join(
                "|",
              ),
            );

            const inspect = yield* runCli(runtime, cacheDirectory, ["inspect"]);

            expect(inspect.exitCode).toBe(0);
            expect(inspect.stdout).toContain(`op://${secondaryVault}/payments/STRIPE_KEY`);
            expect(inspect.stdout).toContain("cache");
            expect(inspect.stdout).not.toContain(apiToken);
          }),
        );
      });
    });
  },
);
