import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { docsOf, enviVersion, fixture, runCli, runtimes } from "./helpers.ts";

layer(NodeServices.layer)("envi CLI", (it) => {
  describe.each(runtimes)("on %s", (runtime) => {
    it.effect("prints the package version", () =>
      Effect.gen(function* () {
        const result = yield* runCli(runtime, fixture("app"), ["--version"]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain(enviVersion);
      }),
    );

    it.effect("inspects the nearest config with hidden secrets", () =>
      Effect.gen(function* () {
        const result = yield* runCli(runtime, fixture("app/nested"), ["inspect"]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("memory://db/development");
        expect(result.stdout).not.toContain("postgres://");
      }),
    );

    it.effect("exports real values for the stage of the flag", () =>
      Effect.gen(function* () {
        const result = yield* runCli(runtime, fixture("app"), ["export", "--stage", "production"]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("PORT=3000\nDATABASE_URL=postgres://prod\n");
      }),
    );

    it.effect("prints a report as JSON with --json", () =>
      Effect.gen(function* () {
        const result = yield* runCli(runtime, fixture("app"), ["sync", "--json"]);

        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          stage: "development",
          configs: 1,
          failures: [],
        });
      }),
    );

    it.effect("runs a command with the vars and returns its exit code", () =>
      Effect.gen(function* () {
        const result = yield* runCli(runtime, fixture("app"), [
          "run",
          "--",
          "node",
          "-e",
          "console.log(process.env.DATABASE_URL, process.env.ENVI_STAGE); process.exit(5)",
        ]);

        expect(result.exitCode).toBe(5);
        expect(result.stdout).toBe("postgres://dev development\n");
      }),
    );

    it.effect("starts no child when a var fails, and reports the reference on stderr", () =>
      Effect.gen(function* () {
        const result = yield* runCli(runtime, fixture("broken"), [
          "run",
          "--",
          "node",
          "-e",
          "console.log('started')",
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("Envi failed to resolve 1 var of the stage development");
        expect(result.stderr).toContain(
          "✗ TOKEN: Envi reference failed: NotFound for memory://token",
        );
        expect(result.stderr).toContain("hint: ");
        expect(result.stderr).toContain(`docs: ${docsOf("secret-reference-not-found")}`);
      }),
    );

    it.effect("prints an error as one JSON document on stdout with --json", () =>
      Effect.gen(function* () {
        const result = yield* runCli(runtime, fixture("broken"), ["inspect", "--json"]);
        const report = JSON.parse(result.stdout);

        expect(result.exitCode).toBe(1);
        expect(report.error).toMatchObject({
          error: "VarsError",
          reason: null,
          docs: docsOf("vars"),
          failures: [
            {
              key: "TOKEN",
              config: expect.stringMatching(/broken\/envi\.config\.ts$/u),
              reference: "memory://token",
              error: "SecretReferenceError",
              reason: "NotFound",
            },
          ],
        });
        expect(report.error.hint.length).toBeGreaterThan(0);
      }),
    );

    it.effect("checks a config and exits with 1 for a failed var", () =>
      Effect.gen(function* () {
        const result = yield* runCli(runtime, fixture("broken"), ["check"]);

        expect(result.exitCode).toBe(1);
        expect(result.stdout).toContain(
          "✗ TOKEN: Envi reference failed: NotFound for memory://token",
        );
      }),
    );

    it.effect("rejects a stage that the config does not declare", () =>
      Effect.gen(function* () {
        const result = yield* runCli(runtime, fixture("app"), ["check", "--stage", "qa"]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("qa");
      }),
    );

    it.effect("reports a missing config", () =>
      Effect.gen(function* () {
        const result = yield* runCli(runtime, "/", ["inspect"]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("NoConfig");
        expect(result.stderr).toContain("envi.config.ts");
      }),
    );

    it.effect("rejects --json for run, because the child owns stdout", () =>
      Effect.gen(function* () {
        const result = yield* runCli(runtime, fixture("app"), [
          "run",
          "--json",
          "--",
          "node",
          "-e",
          "",
        ]);

        expect(result.exitCode).not.toBe(0);
        expect(result.stdout).not.toContain("{");
      }),
    );
  });
});
