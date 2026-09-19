import { defineConfig, mem, memoryProvider } from "envi";

export default defineConfig({
  providers: [memoryProvider({})],
  cache: false,
  vars: { TOKEN: mem("token") },
});
