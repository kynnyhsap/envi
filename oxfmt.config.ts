import { defineConfig } from "oxfmt";

export default defineConfig({
  printWidth: 100,
  sortImports: {
    groups: [
      ["builtin", "external"],
      ["internal", "parent", "sibling", "index"],
      ["side_effect", "side_effect_style"],
      ["style"],
    ],
    newlinesBetween: true,
  },
  ignorePatterns: [
    ".agents/**",
    ".claude/**",
    "tools/oxlint/anti-slop/**",
    "**/node_modules",
    "**/dist",
    "**/bun.lock",
    "**/*.tsbuildinfo",
  ],
});
