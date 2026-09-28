import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { docsBase } from "./ErrorClass.ts";
import {
  type AnyEnviError,
  CacheError,
  CacheFailure,
  catalog,
  ConfigLoadError,
  ConfigLoadFailure,
  CustomError,
  CustomReason,
  DecodeError,
  DeriveError,
  ExportError,
  ExportFileError,
  ExportFileFailure,
  isEnviError,
  ProviderError,
  ProviderFailure,
  ReferenceFailure,
  RunError,
  RunFailure,
  SecretReferenceError,
  SettingsError,
  UnknownStageError,
  VarsError,
} from "./Errors.ts";

const token = new SecretReferenceError({
  reason: ReferenceFailure.NotFound,
  provider: "memory",
  reference: "memory://token",
});

/** One error of each class. */
const samples: ReadonlyArray<AnyEnviError> = [
  token,
  new ProviderError({ reason: ProviderFailure.Unavailable, provider: "memory", detail: "Down." }),
  new DecodeError({ key: "PORT", expected: "a number" }),
  new CustomError({ reason: CustomReason.Failed, id: "token", detail: "No.", transient: false }),
  new DeriveError({ thrown: "TypeError", location: "envi.config.ts:3:7" }),
  new VarsError({ stage: "development", failures: [{ key: "TOKEN", error: token }] }),
  new UnknownStageError({ stage: "qa", stages: ["development", "production"] }),
  new CacheError({ reason: CacheFailure.LockTimeout, detail: "Busy." }),
  new ExportError({ key: "TOKEN", format: "dotenv" }),
  new ExportFileError({ reason: ExportFileFailure.WriteFailed, path: "/repo/.env" }),
  new SettingsError({ name: "ENVI_STRICT", expected: "true or false" }),
  new RunError({ reason: RunFailure.CommandNotFound, command: "missing" }),
  new ConfigLoadError({
    reason: ConfigLoadFailure.NotFound,
    path: "/repo/envi.config.ts",
    detail: "No file.",
  }),
];

const readme = new URL("../../../../README.md", import.meta.url);

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

  it.each(samples.map((error) => ({ error, tag: error._tag })))(
    "gives $tag the hint and the docs link of its catalog entry",
    ({ error }) => {
      const entry = catalog.find(
        (candidate) =>
          candidate.error === error._tag &&
          candidate.reason === ("reason" in error ? error.reason : undefined),
      );

      expect(entry).toBeDefined();
      expect(error.hint).toBe(entry?.hint);
      expect(error.docs).toBe(`${docsBase}${entry?.anchor}`);
      expect(error.summary.startsWith("Envi ")).toBe(true);
      expect(isEnviError(error)).toBe(true);
    },
  );

  it.each(
    samples.flatMap((error) => (error instanceof VarsError ? [] : [{ error, tag: error._tag }])),
  )("puts the summary, the hint, and the docs link in the message of $tag", ({ error }) => {
    expect(error.message).toBe(`${error.summary}\n  hint: ${error.hint}\n  docs: ${error.docs}`);
  });
});
