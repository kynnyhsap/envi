import { defineConfig } from "vitest/config";

// The workspace packages resolve to their sources through this export condition.
const sourceCondition = "@envi/source";

export default defineConfig({
  resolve: { conditions: [sourceCondition] },
  ssr: { resolve: { conditions: [sourceCondition] } },
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "onepassword",
          include: ["packages/onepassword/e2e/**/*.test.ts"],
          // Without a service account token, the first test waits for an approval in the 1Password app.
          testTimeout: 120_000,
        },
      },
    ],
  },
});
