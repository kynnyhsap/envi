import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createEnvi,
  DecodeError,
  defineConfig,
  Envi,
  layer,
  SecretReferenceError,
  syncAll,
  VarsError,
} from "./index.ts";
import { mem, memoryProvider } from "./testing.ts";

const provider = memoryProvider({ "db/url": "postgres://fake", port: "5432" });

const config = defineConfig({
  providers: [provider],
  cache: false,
  vars: ({ mem: secret, value }) => ({
    PORT: value("3000").schema(Schema.FiniteFromString),
    DATABASE_URL: secret("db/url"),
    SENTRY_DSN: secret("sentry").optional(),
  }),
});

describe("createEnvi", () => {
  it("loads typed values through promises", async () => {
    const envi = createEnvi(config);
    const env = await envi.load();

    expectTypeOf(env.PORT).toEqualTypeOf<number>();
    expect(env).toEqual({ PORT: 3000, DATABASE_URL: "postgres://fake", SENTRY_DSN: undefined });
    expect((await envi.loadRaw()).PORT).toBe("3000");
    await envi.dispose();
  });

  it("rejects with the tagged error of the Effect API", async () => {
    const envi = createEnvi(
      defineConfig({ providers: [memoryProvider({})], cache: false, vars: { A: mem("a") } }),
    );

    await expect(envi.load()).rejects.toSatisfy(
      (error) =>
        error instanceof VarsError && error.failures[0]?.error instanceof SecretReferenceError,
    );

    await expect(envi.parse({})).rejects.toSatisfy(
      (error) => error instanceof VarsError && error.failures[0]?.error instanceof DecodeError,
    );

    await envi.dispose();
  });

  it("replaces the providers through the overrides", async () => {
    const envi = createEnvi(config, {
      providers: [memoryProvider({ "db/url": "postgres://override" })],
    });

    expect((await envi.load()).DATABASE_URL).toBe("postgres://override");
    await envi.dispose();
  });

  it("mirrors the commands: resolve, check, inspect, export, and cache", async () => {
    const envi = createEnvi(config);

    expect(await envi.resolve(mem("port").schema(Schema.FiniteFromString))).toBe(5432);
    expect((await envi.check()).failures).toEqual([]);
    expect((await envi.inspect()).vars.map((entry) => entry.key)).toEqual([
      "PORT",
      "DATABASE_URL",
      "SENTRY_DSN",
    ]);
    expect(await envi.export("dotenv", { redact: true })).toContain("PORT=3000");
    expect(await envi.cache.path()).toBeUndefined();
    expect(await envi.cache.clear()).toEqual({ removed: 0 });
    await envi.dispose();
  });

  it("runs a command with the resolved vars", async () => {
    const envi = createEnvi(config);

    const report = await envi.run(process.execPath, [
      "-e",
      'process.exit(process.env.DATABASE_URL === "postgres://fake" ? 7 : 1)',
    ]);

    expect(report).toEqual({ exitCode: 7 });
    await envi.dispose();
  });

  it("syncs several clients in one report", async () => {
    const web = createEnvi(config);

    const api = createEnvi(
      defineConfig({ providers: [provider], cache: false, vars: { PORT: mem("port") } }),
    );

    const report = await syncAll([web, api]);

    expect(report.configs).toBe(2);
    expect(report.failures).toEqual([]);
    await web.dispose();
    await api.dispose();
  });
});

describe("layer", () => {
  it("provides the Envi service with the options of a client", async () => {
    const program = Effect.flatMap(Envi.Envi, (envi) => envi.load(config));

    const env = await Effect.runPromise(
      program.pipe(Effect.provide(layer({ cache: false, providers: [provider] }))),
    );

    expect(env.DATABASE_URL).toBe("postgres://fake");
  });
});
