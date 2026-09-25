// The environment variables that more than one service reads. Each one is read in one place.
import * as EffectConfig from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { SettingsError } from "./Errors.ts";

/** The variable that CI systems set. */
export const ciVariable = "CI";

/** The variable that allows or forbids a prompt, such as a desktop app approval. */
export const interactiveVariable = "ENVI_INTERACTIVE";

/** The values of `CI` that mean "not CI". CI systems set `CI` to `true`, `1`, or their name. */
const notCi: ReadonlyArray<string> = ["", "false", "0"];

/** Reads one variable. A value that does not parse fails with the variable name. */
export const read = <A>(
  name: string,
  expected: string,
  setting: EffectConfig.Config<A>,
): Effect.Effect<A, SettingsError> =>
  Effect.mapError(setting, () => new SettingsError({ name, expected }));

/** `true` when `CI` is set to a value other than empty, `false`, or `0`. */
export const isCi: Effect.Effect<boolean> = Effect.map(
  Effect.orElseSucceed(EffectConfig.option(EffectConfig.String(ciVariable)), () =>
    Option.none<string>(),
  ),
  Option.exists((value) => !notCi.includes(value.trim().toLowerCase())),
);

/** `ENVI_INTERACTIVE`. None when the variable is absent. */
export const interactive: Effect.Effect<Option.Option<boolean>, SettingsError> = read(
  interactiveVariable,
  "true or false",
  EffectConfig.option(EffectConfig.Boolean(interactiveVariable)),
);
