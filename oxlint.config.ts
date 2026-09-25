import { defineConfig } from "oxlint";

export default defineConfig({
  options: {
    typeAware: true,
    typeCheck: false,
    denyWarnings: true,
    reportUnusedDisableDirectives: "error",
  },
  plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "node"],
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    { name: "anti-slop-effect", specifier: "./tools/oxlint/anti-slop/effect/index.ts" },
  ],
  categories: {
    correctness: "error",
    suspicious: "error",
  },
  rules: {
    // Vendored anti-slop policy: every custom rule is an error, including in tests.
    "oxc/no-accumulating-spread": "error",
    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": ["error", { allowInTypeGuards: true }],
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-service-constructor-imports": "error",
    "anti-slop-effect/prefer-effect-match": "error",
    // Resolve conflicts between anti-slop and native rules in favor of anti-slop.
    "typescript/consistent-indexed-object-style": "off",
    "unicorn/no-immediate-mutation": "off",
    "unicorn/prefer-reflect-apply": "off",
    "eslint/no-unused-vars": "off",
    "typescript/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    "typescript/no-import-type-side-effects": "error",
    "typescript/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      },
    ],
    "import/no-duplicates": "error",
    "import/no-empty-named-blocks": "error",
    "import/no-self-import": "error",
    // `_tag` is Effect's discriminant on tagged errors, `Exit`, and `Cause`.
    // It is read constantly and is not a private-member convention.
    "eslint/no-underscore-dangle": ["error", { allow: ["_tag"] }],
  },
  overrides: [
    {
      // The core depends only on Effect platform services. It runs on Node and on Bun alike, and
      // only the entry points of `envi` provide the platform layer and read the process.
      files: ["packages/envi/src/core/**/*.ts"],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["node:*", "@effect/platform-*"],
                message: "The core uses only Effect platform services.",
              },
            ],
          },
        ],
        "eslint/no-restricted-globals": [
          "error",
          { name: "Bun", message: "The core runs on Node and on Bun alike." },
          { name: "process", message: "Only the entry points of `envi` read the process." },
        ],
      },
    },
    {
      // A test provides the platform layer of Node itself.
      files: ["packages/envi/src/core/**/*.test.ts"],
      rules: {
        "eslint/no-restricted-imports": "off",
        "eslint/no-restricted-globals": "off",
      },
    },
  ],
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: [
    "**/node_modules",
    "**/.git",
    "**/dist",
    "**/coverage",
    "**/bun.lock",
    // Installed agent assets and third-party plugin source are not application source.
    ".agents/**",
    ".claude/**",
    "tools/oxlint/anti-slop/**",
    // Type-only API sketches and examples. `tsc` checks them through `examples/tsconfig.json`.
    "examples/**",
  ],
});
