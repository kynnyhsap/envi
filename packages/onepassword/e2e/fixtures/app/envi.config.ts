import { defineConfig } from "@kynnyhsap/envi";
// The config of the CLI test against real 1Password. The account name comes from
// `ENVI_PROVIDER_ONEPASSWORD_ACCOUNT`, which the test sets. The test passes `--cache-dir`.
import { onePasswordProvider } from "@kynnyhsap/envi-1password";
import * as Schema from "effect/Schema";

import { primaryVault, secondaryVault } from "../../fixture.ts";

export default defineConfig({
  providers: [onePasswordProvider()],
  cache: { encryption: "none" },
  vars: ({ op }) => ({
    PORT: op(primaryVault, "app", "PORT").schema(Schema.FiniteFromString),
    API_TOKEN: op(`op://${primaryVault}/app/API_TOKEN`),
    STRIPE_KEY: op(secondaryVault, "payments", "STRIPE_KEY"),
  }),
});
