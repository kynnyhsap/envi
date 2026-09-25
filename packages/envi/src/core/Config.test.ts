import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Config from "./Config.ts";
import { ConfigLoadFailure } from "./Errors.ts";
import { memoryProvider } from "./Memory.ts";
import * as Source from "./Source.ts";

const staged = Config.defineConfig({
  stages: ["development", "production"],
  defaultStage: "development",
  providers: [memoryProvider({})],
  vars: ({ stage, mem, value }) => ({
    NODE_ENV: stage === "production" ? "production" : "development",
    PORT: value("3000").schema(Schema.FiniteFromString),
    DATABASE_URL: mem(`db/${stage}`),
    SENTRY_DSN: mem("sentry").optional(),
  }),
});

describe("defineConfig", () => {
  it("infers the env types, the raw types, and the stage type", () => {
    expectTypeOf<Config.Env<typeof staged>>().toEqualTypeOf<{
      readonly NODE_ENV: string;
      readonly PORT: number;
      readonly DATABASE_URL: string;
      readonly SENTRY_DSN: string | undefined;
    }>();

    expectTypeOf<Config.RawEnv<typeof staged>["SENTRY_DSN"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Config.StageOf<typeof staged>>().toEqualTypeOf<"development" | "production">();
  });

  it.effect("accepts a plain object for vars and no stages", () =>
    Effect.gen(function* () {
      const plain = Config.defineConfig({ vars: { PORT: "3000" } });

      expectTypeOf<Config.StageOf<typeof plain>>().toEqualTypeOf<string>();
      expect(Object.keys(yield* Config.varsFor(plain, "anything"))).toEqual(["PORT"]);
    }),
  );

  it.effect("evaluates vars for one stage and turns a plain string into a literal", () =>
    Effect.gen(function* () {
      const vars = yield* Config.varsFor(staged, "production");

      expect(vars["NODE_ENV"]?.origin).toEqual(Source.Origin.Literal({ value: "production" }));
      expect(vars["DATABASE_URL"]?.origin).toEqual(
        Source.Origin.Reference({ provider: "memory", reference: "db/production" }),
      );
    }),
  );

  it.effect("rejects two providers that define one helper name", () =>
    Effect.gen(function* () {
      const twice = Config.defineConfig({
        providers: [memoryProvider({}), memoryProvider({})],
        vars: ({ mem }) => ({ TOKEN: mem("token") }),
      });

      const error = yield* Effect.flip(Config.varsFor(twice, "development"));

      expect(error.reason).toBe(ConfigLoadFailure.InvalidConfig);
      expect(error.detail).toContain("`mem`");
    }),
  );

  it.effect("gives a config without vars an empty record", () =>
    Effect.gen(function* () {
      const providersOnly = Config.defineConfig({ providers: [memoryProvider({})] });

      expect(yield* Config.varsFor(providersOnly, "development")).toEqual({});
    }),
  );
});

describe("selectStage", () => {
  it.effect("prefers the requested stage", () =>
    Effect.gen(function* () {
      expect(yield* Config.selectStage(staged, Option.some("production"))).toBe("production");
    }),
  );

  it.effect("falls back to defaultStage, and then to development", () =>
    Effect.gen(function* () {
      const bare = Config.defineConfig({ vars: {} });

      expect(yield* Config.selectStage(staged, Option.none())).toBe("development");
      expect(yield* Config.selectStage(bare, Option.none())).toBe(Config.fallbackStage);
    }),
  );

  it.effect("rejects a stage that the config does not declare", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Config.selectStage(staged, Option.some("prodution")));

      expect(error.stage).toBe("prodution");
      expect(error.stages).toEqual(["development", "production"]);
    }),
  );

  it.effect("accepts any stage when the config declares none", () =>
    Effect.gen(function* () {
      const bare = Config.defineConfig({ vars: {} });

      expect(yield* Config.selectStage(bare, Option.some("preview-42"))).toBe("preview-42");
    }),
  );
});

describe("schemaOf", () => {
  it.effect("decodes a record of raw strings into the env", () =>
    Effect.gen(function* () {
      const schema = Config.schemaOf(staged, "development");

      const env = yield* Schema.decodeUnknownEffect(schema)({
        NODE_ENV: "development",
        PORT: "8080",
        DATABASE_URL: "postgres://localhost/app",
      });

      expect(env).toEqual({
        NODE_ENV: "development",
        PORT: 8080,
        DATABASE_URL: "postgres://localhost/app",
      });
    }),
  );
});
