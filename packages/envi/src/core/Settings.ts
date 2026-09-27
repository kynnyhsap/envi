// The environment variables that more than one service reads. Each one is read in one place.
import * as EffectConfig from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { SettingsError } from "./Errors.ts";

/** The variable that CI systems set. */
const ciVariable = "CI";

/** The home folder of the OS user. */
const homeVariable = "HOME";

/** The variable that selects the stage. `run` sets it for the child. */
export const stageVariable = "ENVI_STAGE";

/** The variable that allows or forbids a prompt, such as a desktop app approval. */
const interactiveVariable = "ENVI_INTERACTIVE";

/** The values of `CI` that mean "not CI". CI systems set `CI` to `true`, `1`, or their name. */
const notCi: ReadonlyArray<string> = ["", "false", "0"];

/** Reads one variable. A value that does not parse fails with the variable name. */
export const read = <A>(
  name: string,
  expected: string,
  setting: EffectConfig.Config<A>,
): Effect.Effect<A, SettingsError> =>
  Effect.mapError(setting, () => new SettingsError({ name, expected }));

/** Reads one optional variable that holds `true` or `false`. */
export const readBoolean = (name: string): Effect.Effect<Option.Option<boolean>, SettingsError> =>
  read(name, "true or false", EffectConfig.option(EffectConfig.Boolean(name)));

/** Reads one optional variable that holds text. `expected` names the text in the error. */
export const readString = (
  name: string,
  expected: string,
): Effect.Effect<Option.Option<string>, SettingsError> =>
  read(name, expected, EffectConfig.option(EffectConfig.String(name)));

/** `true` when `CI` is set to a value other than empty, `false`, or `0`. */
export const isCi: Effect.Effect<boolean> = Effect.map(
  Effect.orElseSucceed(EffectConfig.option(EffectConfig.String(ciVariable)), () =>
    Option.none<string>(),
  ),
  Option.exists((value) => !notCi.includes(value.trim().toLowerCase())),
);

/** `HOME`. None when the variable is absent. */
export const home: Effect.Effect<Option.Option<string>> = Effect.orElseSucceed(
  EffectConfig.option(EffectConfig.String(homeVariable)),
  () => Option.none<string>(),
);

/** `ENVI_INTERACTIVE`. None when the variable is absent. */
export const interactive: Effect.Effect<Option.Option<boolean>, SettingsError> = readBoolean(
  interactiveVariable,
);

/** `ENVI_STAGE`. None when the variable is absent. */
export const stage: Effect.Effect<Option.Option<string>, SettingsError> = readString(
  stageVariable,
  "a stage name",
);
