import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { Greeter, layer } from "./Greeter.ts";

describe("Greeter", () => {
  it.effect("greets a trimmed name", () =>
    Effect.gen(function* () {
      const greeter = yield* Greeter;

      expect(yield* greeter.greet("  Ada ")).toBe("Hello, Ada!");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fails with EmptyName for a blank name", () =>
    Effect.gen(function* () {
      const greeter = yield* Greeter;
      const error = yield* Effect.flip(greeter.greet("   "));

      expect(error._tag).toBe("EmptyName");
    }).pipe(Effect.provide(layer)),
  );
});
