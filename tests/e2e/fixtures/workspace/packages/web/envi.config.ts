import { defineConfig } from "envi";

import { fileProvider } from "../../../file-provider.ts";

export default defineConfig({
  providers: [fileProvider],
  cache: { encryption: "none" },
  vars: ({ file }) => ({ PUBLIC_NAME: file("public-name").redact(false), SHARED: file("shared") }),
});
