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
    "import/no-cycle": "error",
    // A module names what it exports. Only the configs of tools export a default.
    "import/no-default-export": "error",
    // Type-aware rules. Some of them are also in the categories above; the list names each one.
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/await-thenable": "error",
    "typescript/no-base-to-string": "error",
    "typescript/unbound-method": "error",
    "typescript/restrict-template-expressions": "error",
    "typescript/switch-exhaustiveness-check": "error",
    "typescript/strict-boolean-expressions": "error",
    "typescript/prefer-nullish-coalescing": "error",
    "typescript/return-await": "error",
    "typescript/only-throw-error": "error",
    "typescript/no-deprecated": "error",
    "typescript/prefer-readonly": "error",
    "typescript/no-confusing-void-expression": "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/no-unnecessary-condition": ["error", { allowConstantLoopConditions: true }],
    "eslint/eqeqeq": "error",
    "eslint/no-nested-ternary": "error",
    "eslint/no-param-reassign": "error",
    "eslint/no-console": "error",
    "unicorn/prefer-string-replace-all": "error",
    "unicorn/prefer-import-meta-properties": "error",
    // Size limits. `max-lines` is a ratchet: lower it as the large modules split.
    "eslint/complexity": ["error", 10],
    "eslint/max-depth": ["error", 3],
    "eslint/max-lines": ["error", { max: 650, skipBlankLines: true, skipComments: true }],
    // `_tag` is Effect's discriminant on tagged errors, `Exit`, and `Cause`.
    // It is read constantly and is not a private-member convention.
    "eslint/no-underscore-dangle": ["error", { allow: ["_tag"] }],
  },
  overrides: [
    {
      // A number in the code of a package or a script has a name. A test states its values in place.
      // A function of that code fits on one screen. A test lists its steps in one scenario.
      files: ["packages/*/src/**/*.ts", "scripts/**/*.ts"],
      excludeFiles: ["**/*.test.ts", "**/fixtures/**"],
      rules: {
        "eslint/max-lines-per-function": [
          "error",
          { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true },
        ],
        "eslint/no-magic-numbers": [
          "error",
          {
            ignore: [-1, 0, 1],
            ignoreArrayIndexes: true,
            ignoreDefaultValues: true,
            ignoreEnums: true,
            ignoreNumericLiteralTypes: true,
            ignoreTypeIndexes: true,
            enforceConst: true,
          },
        ],
      },
    },
    {
      // The configs of tools and the Envi configs export a default, because the tools ask for it.
      files: ["*.config.ts", "**/envi.config.ts", "examples/config-*.ts"],
      rules: { "import/no-default-export": "off" },
    },
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
              {
                group: ["../**", "!../../package.json", "@kynnyhsap/*"],
                message:
                  "The core imports only the core. The entry points outside it use the core.",
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
      // Envi never imports a provider, and a module of Envi imports its own files, not its package.
      files: ["packages/envi/src/**/*.ts"],
      excludeFiles: ["packages/envi/src/core/**/*.ts"],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["@kynnyhsap/*"],
                message: "Envi imports its own files, and never a provider.",
              },
            ],
          },
        ],
      },
    },
    {
      // A provider uses only the public entry points of Envi, and runs on Node and on Bun alike.
      files: ["packages/onepassword/src/**/*.ts"],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/envi/src/**", "@kynnyhsap/envi/*", "!@kynnyhsap/envi/testing"],
                message: "A provider imports only the public entry points of Envi.",
              },
              { group: ["node:*"], message: "A provider runs on Node and on Bun alike." },
            ],
          },
        ],
        "eslint/no-restricted-globals": [
          "error",
          { name: "Bun", message: "A provider runs on Node and on Bun alike." },
          { name: "process", message: "A provider reads settings through Effect Config." },
        ],
      },
    },
    {
      // A test uses a package through its public entry points, as a user does.
      files: ["tests/**/*.ts"],
      rules: {
        "eslint/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/packages/*/src/**"],
                message: "A test imports a package through its public entry points.",
              },
            ],
          },
        ],
      },
    },
    {
      // A test provides the platform layer of Node itself.
      files: ["packages/envi/src/core/**/*.test.ts", "packages/envi/src/core/fixtures/**"],
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
    ".claude/**",
    "tools/oxlint/anti-slop/**",
  ],
});
