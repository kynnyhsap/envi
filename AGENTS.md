# AGENTS.md

Envi is a CLI tool for managing `.env` files with 1Password as a secret provider.

**Runtime:** Bun — no build step, runs TypeScript directly
**Type check:** `bun run typecheck` (tsgo)
**Test:** `bun test` · single file: `bun test src/utils/parse.test.ts` · filter: `bun test --filter "parseEnvFile"`
**Run:** `bun run src/cli.ts <command>`

## Voice & Personality

Envi has a name — use it. All user-facing text (CLI output, logs, errors, docs) should reflect the project's identity. Keep the tone concise, helpful, and confident — the way a good CLI tool should feel.

## Key Concepts

- **Templates**: `.env.template` files containing `op://` secret references
- **Secret references**: `op://vault/item/field` format resolved via 1Password
- **Environment substitution**: `${ENV}` in paths/values replaced at runtime
- **Environments**: any string (used for `${ENV}` substitution in templates, default: `default`)
- **3-way merge**: Template + resolved secrets + local overrides

## Maintaining This File

If you discover a convention, pattern, or decision that isn't documented here but should be, ask the user whether to add it to AGENTS.md. Don't update it silently.
