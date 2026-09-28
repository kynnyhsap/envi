// One scenario for each error section of the README that no other end-to-end test reaches. Each
// scenario checks the exit code, the reason, and the docs link on stderr.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { cliPath, docsOf, fixture, makeSandbox, runCli, runProcess, runtimes } from "./helpers.ts";

const app = fixture("cached");

interface Output {
  readonly exitCode: number;
  readonly stderr: string;
}

const expectError = (result: Output, reason: string, section: string) => {
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(reason);
  expect(result.stderr).toContain(`docs: ${docsOf(section)}`);
};

/** A plain file in the sandbox, where a command expects a folder. */
const plainFile = Effect.fn("plainFile")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(directory, "plain-file");

  yield* fs.writeFileString(file, "");

  return file;
});

layer(NodeServices.layer, { excludeTestServices: true })("envi errors", (it) => {
  describe.each(runtimes)("on %s", (runtime) => {
    it.effect("RunError KilledBySignal: a SIGKILL ends the command", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");

        const result = yield* runCli(
          runtime,
          app,
          ["run", "--no-cache", "--", "node", "-e", "process.kill(process.pid, 'SIGKILL')"],
          sandbox.env,
        );

        expectError(result, "KilledBySignal", "run-killed-by-signal");
      }),
    );

    it.effect("ExportFileError WriteFailed: the folder of the output file is missing", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const sandbox = yield* makeSandbox("none");
        const output = path.join(sandbox.directory, "missing", "out.env");

        const result = yield* runCli(
          runtime,
          app,
          ["export", "--no-cache", "--output", output],
          sandbox.env,
        );

        expectError(result, "WriteFailed", "export-file-write-failed");
      }),
    );

    it.effect("CacheError Unwritable: the cache directory is below a file", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const sandbox = yield* makeSandbox("none");
        const file = yield* plainFile(sandbox.directory);

        const result = yield* runCli(
          runtime,
          app,
          ["sync", "--cache-dir", path.join(file, "cache")],
          sandbox.env,
        );

        expectError(result, "Unwritable", "cache-unwritable");
      }),
    );

    it.effect("CacheError Unreadable: the cache directory is a file", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const file = yield* plainFile(sandbox.directory);

        const result = yield* runCli(
          runtime,
          app,
          ["cache", "list", "--cache-dir", file],
          sandbox.env,
        );

        expectError(result, "Unreadable", "cache-unreadable");
      }),
    );
  });

  it.effect("ConfigLoadError UnsupportedRuntime: Node cannot strip the types", () =>
    Effect.gen(function* () {
      const sandbox = yield* makeSandbox("none");

      const result = yield* runProcess(
        "node",
        ["--no-experimental-strip-types", cliPath, "check", "--no-cache"],
        app,
        sandbox.env,
      );

      expectError(result, "UnsupportedRuntime", "config-load-unsupported-runtime");
    }),
  );
});
