import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class EmptyName extends Schema.TaggedError<EmptyName>()("EmptyName", {
  message: Schema.String,
}) {}

export class Greeter extends Context.Service<
  Greeter,
  {
    readonly greet: (name: string) => Effect.Effect<string, EmptyName>;
  }
>()("envi/Greeter") {}

const greet = Effect.fn("Greeter.greet")(function* (name: string) {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return yield* new EmptyName({ message: "The name must not be empty." });
  }

  return `Hello, ${trimmed}!`;
});

export const layer = Layer.succeed(Greeter, { greet });
