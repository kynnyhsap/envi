// The `github` format of `export`: a workflow command on stdout that masks each secret, and the
// vars in the env file of a GitHub Actions step. The runner reads both.
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import { ExportError, ExportFileError, ExportFileFailure } from "./Errors.ts";
import { ExportFormat } from "./Reports.ts";

/** The variable that names the env file of a GitHub Actions step. The runner sets it. */
export const envFileVariable = "GITHUB_ENV";

/** The mode of the env file, when Envi creates it. The runner creates the file before the step. */
const fileMode = 0o600;

const maskCommand = "::add-mask::";

/**
 * A name that the env file holds as one var, and a shell reads: letters, digits, and `_`, not
 * first a digit. A name with `=`, `<<`, or a line break would corrupt the file.
 */
const envName = /^[A-Za-z_]\w*$/u;

/**
 * The env file of the step. An empty value counts as absent. The export reads it before it
 * resolves anything, so a run outside GitHub Actions calls no provider.
 */
export const envFile: Effect.Effect<string, ExportFileError> = Effect.orElseSucceed(
  Config.option(Config.String(envFileVariable)),
  () => Option.none<string>(),
).pipe(
  Effect.map(Option.filter((value) => value !== "")),
  Effect.flatMap(
    Option.match({
      onNone: () =>
        Effect.fail(
          new ExportFileError({
            reason: ExportFileFailure.NoGithubEnv,
            path: `$${envFileVariable}`,
          }),
        ),
      onSome: Effect.succeed,
    }),
  ),
);

/** Escapes the data of a workflow command, as `@actions/core` does. The runner unescapes it. */
const escapeData = (text: string) =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

/**
 * The mask commands of the secret values. The runner masks one log line at a time, so each line
 * of a value gets its own command. A blank line gets none, because the runner rejects it.
 */
const masksOf = (secrets: ReadonlyArray<string>) =>
  Arr.dedupe(secrets.flatMap((value) => value.split(/\r?\n/u)))
    .filter((line) => line.trim() !== "")
    .map((line) => `${maskCommand}${escapeData(line)}`);

/**
 * One var in the `NAME<<DELIMITER` form of the env file. The delimiter is random, as in
 * `@actions/core`, so a value cannot end the block early. The runner keeps each line end of the
 * value, also a CRLF.
 */
const blockOf = ([key, raw]: readonly [string, string]) => {
  const delimiter = `ENVI_${crypto.randomUUID()}`;

  return `${key}<<${delimiter}\n${raw}\n${delimiter}\n`;
};

/**
 * Masks each secret with a workflow command on stdout, and then appends the vars to the env
 * file. Stdout gets no other line, and the runner does not show a mask command in the log. A var
 * name that the file cannot hold fails with an `ExportError` before Envi prints or writes.
 *
 * @param secrets - The value of each secret var of the stage, also of a var that `only` leaves out.
 * @param values - The vars to export, each a key and its raw string.
 */
export const write = Effect.fn("GithubEnv.write")(function* (
  file: string,
  secrets: ReadonlyArray<string>,
  values: ReadonlyArray<readonly [string, string]>,
) {
  const fs = yield* FileSystem.FileSystem;
  const invalid = values.find(([key]) => !envName.test(key));

  if (invalid !== undefined) {
    yield* new ExportError({ key: invalid[0], format: ExportFormat.Github });
  }

  const masks = masksOf(secrets);

  if (masks.length > 0) {
    yield* Console.log(masks.join("\n"));
  }

  yield* Effect.mapError(
    fs.writeFileString(file, values.map(blockOf).join(""), { flag: "a", mode: fileMode }),
    () => new ExportFileError({ reason: ExportFileFailure.WriteFailed, path: file }),
  );

  yield* Effect.logDebug("Envi appended the vars to the env file of GitHub Actions.").pipe(
    Effect.annotateLogs({ file, vars: values.length, masks: masks.length }),
  );
});
