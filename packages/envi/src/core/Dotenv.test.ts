import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as Dotenv from "./Dotenv.ts";
import { ExportError } from "./Errors.ts";
import { ExportFormat } from "./Reports.ts";

describe("Dotenv", () => {
  it.effect.each([
    { value: "postgres://app@db:5432/app", line: "URL=postgres://app@db:5432/app" },
    { value: "", line: "URL=" },
    { value: "two words", line: "URL='two words'" },
    { value: 'say "hi"', line: `URL='say "hi"'` },
    { value: "one\ntwo", line: 'URL="one\\ntwo"' },
  ])("writes $value as $line", ({ value, line }) =>
    Effect.gen(function* () {
      expect(yield* Dotenv.render(ExportFormat.Dotenv, [["URL", value]])).toBe(`${line}\n`);
    }),
  );

  it.effect.each(["it's\n$HOME", "it's\nfine\r", "it's\n`cmd`", "it's\n\\n"])(
    "rejects %j, which no quote style keeps",
    (value) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(Dotenv.render(ExportFormat.Dotenv, [["URL", value]]));

        expect(error).toEqual(new ExportError({ key: "URL", format: ExportFormat.Dotenv }));
      }),
  );

  it.effect("writes json with every value as a string", () =>
    Effect.gen(function* () {
      const text = yield* Dotenv.render(ExportFormat.Json, [
        ["A", "1"],
        ["B", "it's\n$HOME"],
      ]);

      expect(JSON.parse(text)).toEqual({ A: "1", B: "it's\n$HOME" });
      expect(text.endsWith("\n")).toBe(true);
    }),
  );
});
