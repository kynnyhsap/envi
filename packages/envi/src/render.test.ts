import { describe, expect, it } from "vitest";

import * as Render from "./render.ts";

describe("render", () => {
  it("renders a sync report with the counts and the failures", () => {
    const text = Render.sync({
      stage: "development",
      configs: 2,
      providers: [{ provider: "onepassword", secrets: 3, cached: 1, resolved: 1 }],
      failures: [
        {
          key: "TOKEN",
          reference: "op://app/api/token",
          error: "ReferenceError",
          reason: "NotFound",
        },
      ],
      durationMillis: 1234,
    });

    expect(text).toBe(
      [
        "Synced the stage development from 2 configs in 1234 ms.",
        "  onepassword: 3 secrets, 1 cached, 1 resolved",
        "1 var failed:",
        "  ✗ TOKEN (op://app/api/token): ReferenceError NotFound",
        "",
      ].join("\n"),
    );
  });

  it("renders a check report", () => {
    const text = Render.check({
      stage: "production",
      passed: ["PORT"],
      failures: [{ key: "BAD", reference: null, error: "DecodeError", reason: "a finite number" }],
    });

    expect(text).toBe(
      ["Stage: production", "  ✓ PORT", "  ✗ BAD: DecodeError a finite number", ""].join("\n"),
    );
  });

  it("renders an inspect report as aligned columns", () => {
    const text = Render.inspect({
      stage: "development",
      vars: [
        {
          key: "PORT",
          provider: null,
          reference: null,
          origin: "literal",
          resolvedAt: null,
          redacted: false,
          value: "3000",
        },
        {
          key: "DATABASE_URL",
          provider: "onepassword",
          reference: "op://app/postgres/url",
          origin: "cache",
          resolvedAt: "2026-01-01T00:00:00.000Z",
          redacted: true,
          value: null,
        },
      ],
    });

    expect(text).toBe(
      [
        "Stage: development",
        "KEY           ORIGIN   REFERENCE              VALUE",
        "PORT          literal  -                      3000",
        "DATABASE_URL  cache    op://app/postgres/url  <redacted>",
        "",
      ].join("\n"),
    );
  });

  it("renders the cache reports", () => {
    expect(Render.cacheClear({ removed: 2 })).toBe("Removed 2 cache entries.\n");
    expect(Render.cacheList({ directory: null, entries: [] })).toBe("The cache holds no entry.\n");

    expect(
      Render.cacheList({
        directory: "/home/dev/.cache/envi",
        entries: [
          {
            provider: "onepassword",
            reference: "op://app/postgres/url",
            resolvedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    ).toBe(
      [
        "Directory: /home/dev/.cache/envi",
        "PROVIDER     REFERENCE              RESOLVED",
        "onepassword  op://app/postgres/url  2026-01-01T00:00:00.000Z",
        "",
      ].join("\n"),
    );
  });
});
