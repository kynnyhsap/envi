import { onePasswordProvider, op } from "@envi/1password";
// Config 1: a plain object. No stage logic, no function.
import { defineConfig } from "envi";

export default defineConfig({
  providers: [onePasswordProvider({ account: "my-team" })],
  vars: {
    PORT: "3000",
    STRIPE_KEY: op("payments", "stripe", "secret-key"),
  },
});
