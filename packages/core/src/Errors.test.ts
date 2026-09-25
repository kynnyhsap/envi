import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  catalog,
  ConfigLoadError,
  ConfigLoadFailure,
  docsBase,
  ReferenceFailure,
  SecretReferenceError,
  VarsError,
} from "./Errors.ts";

const readme = new URL("../../../README.md", import.meta.url);

describe("Errors", () => {
  it.effect("has a README section with the hint for each catalog entry", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const text = yield* fs.readFileString(readme.pathname);

      for (const entry of catalog) {
        expect(text, entry.anchor).toContain(`<a id="${entry.anchor}"></a>`);
        expect(text, entry.anchor).toContain(`Next action: ${entry.hint}`);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it("gives every catalog entry a distinct anchor", () => {
    const anchors = catalog.map((entry) => entry.anchor);

    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("puts the summary, the hint, and the docs link in the message", () => {
    const error = new SecretReferenceError({
      reason: ReferenceFailure.NotFound,
      provider: "memory",
      reference: "memory://token",
    });

    expect(error.docs).toBe(`${docsBase}error-secret-reference-not-found`);
    expect(error.message).toBe(`${error.summary}\n  hint: ${error.hint}\n  docs: ${error.docs}`);
    expect(error.summary).toContain("memory://token");
  });

  it("lists each failed var in the message of VarsError", () => {
    const token = new SecretReferenceError({
      reason: ReferenceFailure.NotFound,
      provider: "memory",
      reference: "memory://token",
    });

    const error = new VarsError({
      stage: "development",
      config: "/repo/envi.config.ts",
      failures: [{ key: "TOKEN", error: token }],
    });

    expect(error.message.split("\n")).toEqual([
      "Envi failed to resolve 1 var of the stage development in /repo/envi.config.ts: TOKEN",
      `  ✗ TOKEN: ${token.summary}`,
      `    hint: ${token.hint}`,
      `    docs: ${token.docs}`,
    ]);
  });

  it("names the location of a config error instead of the path when it is known", () => {
    const error = new ConfigLoadError({
      reason: ConfigLoadFailure.ConfigSyntax,
      path: "/repo/envi.config.ts",
      detail: "The file has a syntax error.",
      location: "/repo/envi.config.ts:4:3",
    });

    expect(error.summary).toContain("/repo/envi.config.ts:4:3");
    expect(error.docs).toBe(`${docsBase}error-config-load-config-syntax`);
  });
});
