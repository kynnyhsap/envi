// Runs the built CLI against real 1Password, on Node and on Bun. It needs the fixture:
// `bun fixture:onepassword setup`. Without a token and an account name, the suite skips itself.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { fileURLToPath } from "node:url";

import { cliPath, runProcess } from "../../../tests/e2e/helpers.ts";
import { expected } from "./expected.ts";
import { accountVariable, primaryVault, secondaryVault, tokenVariable } from "./fixture.ts";

const account = process.env[accountVariable];

const token = process.env[tokenVariable];

/**
 * The credential of the CLI process. The token wins over the account name. The token goes into
 * `OP_SERVICE_ACCOUNT_TOKEN`, the variable that a CI system sets, so `run` must remove it too.
 */
const credential: Record<string, string> =
  token === undefined
    ? { ENVI_PROVIDER_ONEPASSWORD_ACCOUNT: account ?? "" }
    : { OP_SERVICE_ACCOUNT_TOKEN: token };

const cwd = fileURLToPath(new URL("./fixtures/app", import.meta.url));

const printVars =
  "console.log([process.env.PORT, process.env.API_TOKEN, process.env.STRIPE_KEY, Object.keys(process.env).some((name) => name.startsWith('ENVI_PROVIDER_') || name === 'OP_SERVICE_ACCOUNT_TOKEN') ? 'leaked' : 'removed'].join('|'))";

/** Runs one command of the built CLI. A flag follows the command. */
const runCli = (
  runtime: string,
  cacheDirectory: string,
  command: string,
  args: ReadonlyArray<string>,
) =>
  runProcess(runtime, [cliPath, command, "--cache-dir", cacheDirectory, ...args], cwd, credential);

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

            // The fixture lives inside this repository, and `sync` searches the whole repository
            // by default. `up` keeps the search to the fixture app.
            const sync = yield* runCli(runtime, cacheDirectory, "sync", [
              "--config-search",
              "up",
              "--json",
            ]);

            expect(sync.exitCode).toBe(0);
            expect(sync.stdout).not.toContain(stripeKey);

            const child = yield* runCli(runtime, cacheDirectory, "run", [
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

            const inspect = yield* runCli(runtime, cacheDirectory, "inspect", []);

            // The row of a var: the key, the origin, the reference, and the hidden value.
            const stripeRow = inspect.stdout
              .split("\n")
              .find((line) => line.startsWith("STRIPE_KEY "));

            expect(inspect.exitCode).toBe(0);
            expect(stripeRow?.split(/\s+/u)).toEqual([
              "STRIPE_KEY",
              "cache",
              `op://${secondaryVault}/payments/STRIPE_KEY`,
              "<redacted>",
            ]);
            expect(inspect.stdout).not.toContain(apiToken);
          }),
        );
      });
    });
  },
);
