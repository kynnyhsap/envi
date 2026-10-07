import { defineConfig } from "@kynnyhsap/envi";

import { fileProvider } from "../../file-provider.ts";

// The default stage differs from the stage of the web config, so a sync of both has two stages.
export default defineConfig({
  stages: ["development", "production"],
  defaultStage: "production",
  providers: [fileProvider],
  cache: { encryption: "none" },
  vars: ({ stage, file }) => ({ API_TOKEN: file(`token-${stage}`) }),
});
