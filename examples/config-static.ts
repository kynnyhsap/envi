// Config 1: a plain object. No stage logic, no function.
import { defineConfig } from "@kynnyhsap/envi";
import { onePasswordProvider, op } from "@kynnyhsap/envi-1password";

export default defineConfig({
  providers: [onePasswordProvider({ account: "my-team" })],
  vars: {
    PORT: "3000",
    STRIPE_KEY: op("payments", "stripe", "secret-key"),
  },
});
