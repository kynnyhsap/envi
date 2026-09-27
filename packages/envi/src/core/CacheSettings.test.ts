import * as NodePath from "@effect/platform-node-shared/NodePath";
import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as CacheSettings from "./CacheSettings.ts";
import { SettingsError } from "./Errors.ts";

type Environment = Readonly<Record<string, string>>;

const selectWith = (
  overrides: Partial<CacheSettings.Overrides>,
  configKey: Option.Option<unknown>,
  environment: Environment,
) =>
  CacheSettings.select({ ...CacheSettings.noOverrides, ...overrides }, configKey).pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(environment))),
    Effect.provide(NodePath.layer),
  );

const home = "/home/dev";

describe("CacheSettings.select", () => {
  it.effect(
    "takes the directory from the flag, the option, the variable, the config key, HOME",
    () =>
      Effect.gen(function* () {
        const flag = { directory: Option.some("/from/flag") };
        const option = { option: Option.some({ directory: "/from/option" }) };
        const variable = { ENVI_CACHE_DIR: "/from/variable" };
        const config = Option.some({ directory: "/from/config" });

        const directoryOf = (...args: Parameters<typeof selectWith>) =>
          Effect.map(selectWith(...args), (selection) => selection.directory);

        expect(
          yield* directoryOf({ ...flag, ...option }, config, { HOME: home, ...variable }),
        ).toEqual(flag.directory);
        expect(yield* directoryOf(option, config, { HOME: home, ...variable })).toEqual(
          Option.some("/from/option"),
        );
        expect(yield* directoryOf({}, config, { HOME: home, ...variable })).toEqual(
          Option.some(variable.ENVI_CACHE_DIR),
        );
        expect(yield* directoryOf({}, config, { HOME: home })).toEqual(Option.some("/from/config"));
        expect(yield* directoryOf({}, Option.none(), { HOME: home })).toEqual(
          Option.some(`${home}/.cache/envi`),
        );
        expect(yield* directoryOf({}, Option.none(), {})).toEqual(Option.none());
      }),
  );

  it.effect.each<{
    readonly name: string;
    readonly overrides: Partial<CacheSettings.Overrides>;
    readonly config: Option.Option<CacheSettings.CacheKey>;
    readonly environment: Environment;
    readonly enabled: boolean;
  }>([
    { name: "on by default", overrides: {}, config: Option.none(), environment: {}, enabled: true },
    {
      name: "off in CI",
      overrides: {},
      config: Option.none(),
      environment: { CI: "true" },
      enabled: false,
    },
    {
      name: "on in CI with the variable",
      overrides: {},
      config: Option.none(),
      environment: { CI: "true", ENVI_CACHE_ENABLED: "true" },
      enabled: true,
    },
    {
      name: "on in CI with the flag",
      overrides: { enabled: Option.some(true) },
      config: Option.none(),
      environment: { CI: "true" },
      enabled: true,
    },
    {
      name: "off with `cache: false`",
      overrides: {},
      config: Option.some(false),
      environment: {},
      enabled: false,
    },
    {
      name: "on with the variable over `cache: false`",
      overrides: {},
      config: Option.some(false),
      environment: { ENVI_CACHE_ENABLED: "true" },
      enabled: true,
    },
    {
      name: "on with the flag over `cache: false`",
      overrides: { enabled: Option.some(true) },
      config: Option.some(false),
      environment: {},
      enabled: true,
    },
    {
      name: "on with an option that replaces `cache: false`",
      overrides: { option: Option.some({}) },
      config: Option.some(false),
      environment: {},
      enabled: true,
    },
    {
      name: "off with the option `false` over the variable",
      overrides: { option: Option.some(false) },
      config: Option.none(),
      environment: { ENVI_CACHE_ENABLED: "true" },
      enabled: false,
    },
    {
      name: "on with the flag over the option `false`",
      overrides: { enabled: Option.some(true), option: Option.some(false) },
      config: Option.none(),
      environment: {},
      enabled: true,
    },
  ])("is $name", ({ overrides, config, environment, enabled }) =>
    Effect.gen(function* () {
      const selection = yield* selectWith(overrides, config, { HOME: home, ...environment });

      expect(selection.enabled).toBe(enabled);
    }),
  );

  it.effect("takes the durations from the option, which replaces the whole config key", () =>
    Effect.gen(function* () {
      const config = Option.some({ ttl: "1 hour", maxStale: "2 days" });
      const fromConfig = yield* selectWith({}, config, { HOME: home });

      const fromOption = yield* selectWith({ option: Option.some({ ttl: "5 minutes" }) }, config, {
        HOME: home,
      });

      expect([fromConfig.ttl, fromConfig.maxStale]).toEqual([Duration.hours(1), Duration.days(2)]);
      expect([fromOption.ttl, fromOption.maxStale]).toEqual([
        Duration.minutes(5),
        CacheSettings.defaultMaxStale,
      ]);
    }),
  );

  it.effect.each<{
    readonly overrides: Partial<CacheSettings.Overrides>;
    readonly config: Option.Option<unknown>;
    readonly environment: Environment;
    readonly name: string;
  }>([
    { overrides: {}, config: Option.some({ ttl: "soon" }), environment: {}, name: "cache.ttl" },
    { overrides: {}, config: Option.some("yes"), environment: {}, name: "cache" },
    {
      overrides: {},
      config: Option.none(),
      environment: { ENVI_CACHE_ENABLED: "maybe" },
      name: "ENVI_CACHE_ENABLED",
    },
  ])("rejects a value of $name that it cannot read", ({ overrides, config, environment, name }) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        selectWith(overrides, config, { HOME: home, ...environment }),
      );

      expect(error).toBeInstanceOf(SettingsError);
      expect(error.name).toBe(name);
    }),
  );
});
