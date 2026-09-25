import { defineConfig } from "@kynnyhsap/envi";
import { memoryProvider } from "@kynnyhsap/envi/testing";
import * as Schema from "effect/Schema";

export default defineConfig({
  providers: [memoryProvider({ good: "8080", bad: "not-a-number" })],
  vars: ({ mem }) => ({
    GOOD_PORT: mem("good").schema(Schema.FiniteFromString),
    BAD_PORT: mem("bad").schema(Schema.FiniteFromString),
  }),
});
