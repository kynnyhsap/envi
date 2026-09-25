import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { BooleanFromString } from "./Codecs.ts";

describe("BooleanFromString", () => {
  it.effect("decodes true, false, 1, and 0, and rejects any other text", () =>
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownEffect(BooleanFromString);

      expect(yield* decode("true")).toBe(true);
      expect(yield* decode("1")).toBe(true);
      expect(yield* decode("false")).toBe(false);
      expect(yield* decode("0")).toBe(false);
      expect(yield* Effect.flip(decode("yes"))).toBeDefined();
      expect(yield* Schema.encodeEffect(BooleanFromString)(true)).toBe("true");
    }),
  );
});
