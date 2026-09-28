import { describe, expect, it } from "vitest";

import * as Render from "./render.ts";

describe("render", () => {
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
});
