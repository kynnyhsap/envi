import { describe, expect, it } from "@effect/vitest";
import { Source } from "@envi/core";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { describeReference, op, providerId, Reference } from "./Reference.ts";

const decode = (source: Source.AnySource) =>
  Source.Origin.$match(source.origin, {
    Reference: (origin) => Schema.decodeUnknownEffect(Reference)(origin.reference),
    Custom: () => Effect.die("not a reference"),
    Environment: () => Effect.die("not a reference"),
    Literal: () => Effect.die("not a reference"),
  });

describe("op", () => {
  it.effect("turns all three forms into one normalized reference", () =>
    Effect.gen(function* () {
      const fromString = yield* decode(op("op://app/postgres/url"));
      const fromParts = yield* decode(op("app", "postgres", "url"));
      const fromObject = yield* decode(op({ vault: "app", item: "postgres", field: "url" }));

      expect(fromString).toEqual({ vault: "app", item: "postgres", field: "url" });
      expect(fromParts).toEqual(fromString);
      expect(fromObject).toEqual(fromString);
      expect(describeReference(fromString)).toBe("op://app/postgres/url");
    }),
  );

  it.effect("keeps the section and the account", () =>
    Effect.gen(function* () {
      const fromString = yield* decode(op("op://observability/sentry/web/dsn"));

      const fromObject = yield* decode(
        op({
          account: "partner-team",
          vault: "observability",
          item: "sentry",
          section: "web",
          field: "dsn",
        }),
      );

      expect(fromString).toEqual({
        vault: "observability",
        item: "sentry",
        section: "web",
        field: "dsn",
      });
      expect(describeReference(fromObject)).toBe("op://observability/sentry/web/dsn");
      expect(fromObject.account).toBe("partner-team");
    }),
  );

  it("builds a redacted descriptor for the provider", () => {
    const source = op("op://app/postgres/url");

    expect(source.isRedacted).toBe(true);
    expect(source.origin).toMatchObject({ provider: providerId });
  });

  it.effect("rejects a reference that Envi does not support", () =>
    Effect.gen(function* () {
      const invalid = [
        "https://app/postgres/url",
        "op://app/postgres",
        "op://app/postgres/a/b/c",
        "op://app//url",
        "op://app/postgres/code?attribute=otp",
        "op://app/postgres/key?ssh-format=openssh",
      ];

      for (const text of invalid) {
        expect(yield* Effect.isFailure(decode(op(text)))).toBe(true);
      }

      expect(yield* Effect.isFailure(decode(op({ vault: "", item: "a", field: "b" })))).toBe(true);
    }),
  );
});
