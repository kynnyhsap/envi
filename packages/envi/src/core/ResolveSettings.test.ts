import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { SettingsError } from "./Errors.ts";
import { withEnv } from "./fixtures/Support.ts";
import * as ResolveSettings from "./ResolveSettings.ts";

const none = Option.none<boolean>();

describe("ResolveSettings", () => {
  it.effect.each([
    { name: "the default", call: none, layer: none, env: {}, config: none, strict: false },
    {
      name: "the config",
      call: none,
      layer: none,
      env: {},
      config: Option.some(true),
      strict: true,
    },
    {
      name: "ENVI_STRICT over the config",
      call: none,
      layer: none,
      env: { ENVI_STRICT: "false" },
      config: Option.some(true),
      strict: false,
    },
    {
      name: "the layer over ENVI_STRICT",
      call: none,
      layer: Option.some(true),
      env: { ENVI_STRICT: "false" },
      config: none,
      strict: true,
    },
    {
      name: "the call over the layer",
      call: Option.some(false),
      layer: Option.some(true),
      env: {},
      config: none,
      strict: false,
    },
    {
      name: "CI over every setting",
      call: Option.some(false),
      layer: none,
      env: { CI: "true" },
      config: none,
      strict: true,
    },
  ])("selects strict from $name", ({ call, layer, env, config, strict }) =>
    Effect.gen(function* () {
      const selection = yield* ResolveSettings.select(
        { callStrict: call, strict: layer, interactive: none },
        config,
      ).pipe(withEnv(env));

      expect(selection.strict).toBe(strict);
    }),
  );

  it.effect("rejects an ENVI_STRICT value that is not a boolean", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        ResolveSettings.select({ callStrict: none, strict: none, interactive: none }, none).pipe(
          withEnv({ ENVI_STRICT: "maybe" }),
        ),
      );

      expect(error).toEqual(new SettingsError({ name: "ENVI_STRICT", expected: "true or false" }));
    }),
  );
});
