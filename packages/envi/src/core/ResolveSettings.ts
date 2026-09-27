// The resolve settings: `strict` and `interactive`, with the one precedence order of every setting.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { SettingsError } from "./Errors.ts";
import * as Settings from "./Settings.ts";

/** The variable that turns the stale fallback off. */
const strictVariable = "ENVI_STRICT";

/** The settings above the config: the option of a call, and the options of a client or a layer. */
export interface Overrides {
  /** The `strict` option of one call. */
  readonly callStrict: Option.Option<boolean>;
  /** The `strict` option of a client or a layer. */
  readonly strict: Option.Option<boolean>;
  readonly interactive: Option.Option<boolean>;
}

export interface Selection {
  /** `true` turns the stale fallback off. CI is always strict. */
  readonly strict: boolean;
  /** `true` allows a prompt, such as a desktop app approval. */
  readonly interactive: boolean;
}

/**
 * Selects `strict` from the call, the client or the layer, `ENVI_STRICT`, the config, and the
 * default `false`. CI is always strict. Selects `interactive` from the client or the layer,
 * `ENVI_INTERACTIVE`, and the default: `true` outside CI.
 */
export const select = Effect.fn("ResolveSettings.select")(function* (
  overrides: Overrides,
  configStrict: Option.Option<boolean>,
): Effect.fn.Return<Selection, SettingsError> {
  const isCi = yield* Settings.isCi;
  const strictFromEnvironment = yield* Settings.readBoolean(strictVariable);
  const interactiveFromEnvironment = yield* Settings.interactive;

  const strict = Option.firstSomeOf([
    overrides.callStrict,
    overrides.strict,
    strictFromEnvironment,
    configStrict,
  ]);

  return {
    strict: isCi || Option.getOrElse(strict, () => false),
    interactive: Option.getOrElse(
      Option.orElse(overrides.interactive, () => interactiveFromEnvironment),
      () => !isCi,
    ),
  };
});
