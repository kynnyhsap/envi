// The text of `export`: dotenv lines or a json object. A value that dotenv cannot keep fails the
// export with the var key, and never with the value.
import * as Effect from "effect/Effect";

import { ExportError } from "./Errors.ts";
import { ExportFormat } from "./Reports.ts";

/** A value that every dotenv parser reads as is. */
const bare = /^[\w./:@+=,-]*$/u;

/** A value that single quotes keep: no single quote and no line break. */
const singleQuotable = /^[^'\n\r]*$/u;

/** The characters that parsers read in different ways inside double quotes. */
const doubleQuoteHazard = /["$\\`\r]/u;

const line = (key: string, raw: string): Effect.Effect<string, ExportError> => {
  if (bare.test(raw)) {
    return Effect.succeed(`${key}=${raw}`);
  }

  if (singleQuotable.test(raw)) {
    return Effect.succeed(`${key}='${raw}'`);
  }

  // Parsers disagree about escapes and expansion inside double quotes. Envi writes only `\n`.
  return doubleQuoteHazard.test(raw)
    ? Effect.fail(new ExportError({ key, format: ExportFormat.Dotenv }))
    : Effect.succeed(`${key}="${raw.replaceAll("\n", "\\n")}"`);
};

/** The text of the values in one format. Each value is a key and its raw string. */
export const render = (
  format: ExportFormat,
  values: ReadonlyArray<readonly [string, string]>,
): Effect.Effect<string, ExportError> =>
  format === ExportFormat.Json
    ? Effect.succeed(`${JSON.stringify(Object.fromEntries(values), null, 2)}\n`)
    : Effect.map(
        Effect.forEach(values, ([key, raw]) => line(key, raw)),
        (lines) => `${lines.join("\n")}\n`,
      );
