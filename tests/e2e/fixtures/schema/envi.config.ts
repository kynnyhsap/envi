import * as Schema from "effect/Schema";
import { defineConfig } from "envi";
import { memoryProvider } from "envi/testing";

export default defineConfig({
  providers: [memoryProvider({ good: "8080", bad: "not-a-number" })],
  vars: ({ mem }) => ({
    GOOD_PORT: mem("good").schema(Schema.FiniteFromString),
    BAD_PORT: mem("bad").schema(Schema.FiniteFromString),
  }),
});
