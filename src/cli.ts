import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Argument, Command } from "effect/unstable/cli";

import packageJson from "../package.json" with { type: "json" };
import { Greeter } from "./Greeter.ts";

const name = Argument.String("name").pipe(Argument.withDescription("The name to greet."));

const greet = Command.make("greet", { name }, (config) =>
  Effect.gen(function* () {
    const greeter = yield* Greeter;

    yield* Console.log(yield* greeter.greet(config.name));
  }),
).pipe(Command.withDescription("Print a greeting."));

export const command = Command.make("envi").pipe(
  Command.withDescription("Manage environment variables with 1Password."),
  Command.withSubcommands([greet]),
);

export const run = Command.run(command, { version: packageJson.version });
