import { defineConfig } from "@kynnyhsap/envi";

import { fileProvider } from "../../../file-provider.ts";

export default defineConfig({
  providers: [fileProvider],
  cache: { encryption: "none" },
  vars: ({ file }) => ({ API_TOKEN: file("token-development"), SHARED: file("shared") }),
});
