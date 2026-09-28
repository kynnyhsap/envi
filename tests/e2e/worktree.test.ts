// Use case 1: a user copies a monorepo to a new worktree, sets up env once, and runs the whole
// stack. Two worktrees share one cache, so the new worktree needs no provider call.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import { SyncReport } from "@kynnyhsap/envi";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { fileURLToPath } from "node:url";

import {
  decodeJson,
  fixture,
  makeSandbox,
  providerCalls,
  runCli,
  runtimes,
  type Sandbox,
  secrets,
} from "./helpers.ts";

const repoModules = fileURLToPath(new URL("../../node_modules", import.meta.url));

/**
 * A copy of the workspace fixture in the sandbox. The configs import the file provider from three
 * folders up, and `node_modules` links to the modules of the repo.
 */
const worktree = Effect.fn("worktree")(function* (sandbox: Sandbox, name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.join(sandbox.directory, name);
  const repo = path.join(root, "repo");

  yield* fs.makeDirectory(root);
  yield* fs.copy(fixture("workspace"), repo);
  yield* fs.copyFile(fixture("file-provider.ts"), path.join(root, "file-provider.ts"));
  yield* fs.symlink(repoModules, path.join(root, "node_modules"));

  return repo;
});

layer(NodeServices.layer, { excludeTestServices: true })("a new worktree", (it) => {
  describe.each(runtimes)("on %s", (runtime) => {
    it.effect("syncs from the shared cache, and runs each package without a provider call", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const sandbox = yield* makeSandbox("none");
        const cache = ["--cache-dir", sandbox.cacheDirectory];
        const sync = ["sync", ...cache, "--config-search", "down", "--json"];
        const first = yield* worktree(sandbox, "first");

        yield* runCli(runtime, first, sync, sandbox.env);

        const second = yield* worktree(sandbox, "second");
        const setUp = yield* runCli(runtime, second, sync, sandbox.env);

        const runs = yield* Effect.forEach(["web", "api"], (name) =>
          runCli(
            runtime,
            path.join(second, "packages", name),
            ["run", ...cache, "--", "node", "-e", "console.log(process.env.SHARED)"],
            sandbox.env,
          ),
        );

        expect((yield* decodeJson(SyncReport, setUp.stdout)).providers).toEqual([
          { provider: "file", secrets: 3, cached: 3, resolved: 0 },
        ]);
        expect(runs.map((result) => [result.exitCode, result.stdout.trim()])).toEqual([
          [0, secrets.shared],
          [0, secrets.shared],
        ]);
        // Only the sync of the first worktree called the provider.
        expect(yield* providerCalls(sandbox)).toEqual([
          ["public-name", "shared", "token-development"],
        ]);
      }),
    );
  });
});
