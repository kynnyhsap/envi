import { defineConfig } from "@kynnyhsap/envi";

// The telemetry tests. `custom()` throws an error whose message holds a secret, and no span and no
// log may hold that message.
import { fileProvider } from "../file-provider.ts";

export default defineConfig({
  providers: [fileProvider],
  cache: false,
  vars: ({ file, custom }) => ({
    API_TOKEN: file("token-development"),
    LEAKY: custom({
      id: "leaky",
      from: { password: file("db-password") },
      resolve: ({ password }) => {
        throw new Error(`cannot connect with ${password}`);
      },
    }),
  }),
});
