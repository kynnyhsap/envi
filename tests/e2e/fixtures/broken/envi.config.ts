import { defineConfig } from "envi";
import { mem, memoryProvider } from "envi/testing";

export default defineConfig({
  providers: [memoryProvider({})],
  cache: false,
  vars: { TOKEN: mem("token") },
});
