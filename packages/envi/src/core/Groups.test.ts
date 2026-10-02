import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";

import { defineConfig } from "./Config.ts";
import * as Groups from "./Groups.ts";
import { mem, memoryProvider } from "./Memory.ts";

const shared = memoryProvider({});

const member = (file: string, stage: string, provider = shared): Groups.Member => ({
  config: {
    ...defineConfig({ providers: [provider], vars: { A: mem("a") } }),
    path: Option.some(file),
  },
  stage,
  policy: {
    cache: true,
    settings: {
      stage,
      refresh: false,
      strict: false,
      interactive: true,
      ttl: Duration.days(1),
      maxStale: Duration.days(7),
    },
  },
  providers: [provider],
  vars: { A: mem("a") },
});

describe("Groups", () => {
  it("keeps the var keys of one config", () => {
    const [group] = Groups.of([member("/app/envi.config.ts", "development")]);

    expect(Object.keys(group?.sources ?? {})).toEqual(["A"]);
    expect(group?.origins["A"]).toEqual({ key: "A", config: Option.some("/app/envi.config.ts") });
  });

  it("puts configs with one stage and one provider instance into one group", () => {
    const groups = Groups.of([
      member("/app/envi.config.ts", "development"),
      member("/api/envi.config.ts", "development"),
    ]);

    expect(groups).toHaveLength(1);
    expect(Object.keys(groups[0]?.sources ?? {})).toEqual(["0:A", "1:A"]);
    expect(groups[0]?.origins["1:A"]).toEqual({
      key: "A",
      config: Option.some("/api/envi.config.ts"),
    });
  });

  it("splits configs of two stages", () => {
    const groups = Groups.of([
      member("/app/envi.config.ts", "development"),
      member("/api/envi.config.ts", "production"),
    ]);

    expect(groups.map((group) => group.stage)).toEqual(["development", "production"]);
  });

  it("splits configs that bind one provider id to two instances", () => {
    const groups = Groups.of([
      member("/app/envi.config.ts", "development"),
      member("/api/envi.config.ts", "development", memoryProvider({})),
    ]);

    expect(groups).toHaveLength(2);
  });
});
