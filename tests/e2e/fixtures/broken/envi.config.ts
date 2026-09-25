import { defineConfig } from "@kynnyhsap/envi";
import { mem, memoryProvider } from "@kynnyhsap/envi/testing";

export default defineConfig({
  providers: [memoryProvider({})],
  cache: false,
  vars: { TOKEN: mem("token") },
});
