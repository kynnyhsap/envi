import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { ChildProcess } from "effect/unstable/process";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../../dist/envi.js", import.meta.url));

const runCli = Effect.fn("runCli")(function* (runtime: string, args: ReadonlyArray<string>) {
  const handle = yield* ChildProcess.make(runtime, [cliPath, ...args]);

  const [exitCode, stdout, stderr] = yield* Effect.all(
    [
      handle.exitCode,
      Stream.mkString(Stream.decodeText(handle.stdout)),
      Stream.mkString(Stream.decodeText(handle.stderr)),
    ],
    { concurrency: "unbounded" },
  );

  return { exitCode, stdout, stderr };
});

layer(NodeServices.layer)("envi CLI", (it) => {
  describe.each(["node", "bun"])("on %s", (runtime) => {
    it.effect("prints a greeting", () =>
      Effect.gen(function* () {
        const result = yield* runCli(runtime, ["greet", "Ada"]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("Hello, Ada!\n");
      }),
    );

    it.effect("prints the package version", () =>
      Effect.gen(function* () {
        const result = yield* runCli(runtime, ["--version"]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("0.0.0");
      }),
    );

    it.effect("exits with a failure code for a blank name", () =>
      Effect.gen(function* () {
        const result = yield* runCli(runtime, ["greet", " "]);

        expect(result.exitCode).toBe(1);
        // The default Effect logger writes failures to stdout.
        expect(result.stdout + result.stderr).toContain("EmptyName");
      }),
    );
  });
});
