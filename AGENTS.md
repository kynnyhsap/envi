# AGENTS.md

Envi is a CLI tool for managing `.env` files with pluggable secret providers (1Password, Proton Pass).

**Runtime:** Bun — no build step, runs TypeScript directly
**Type check:** `bun run typecheck` (tsgo)
**Test:** `bun test` · single file: `bun test src/utils/parse.test.ts` · filter: `bun test --filter "parseEnvFile"`
**Run:** `bun run src/cli.ts <command>`

## Voice & Personality

Envi has a name — use it. All user-facing text (CLI output, logs, errors, docs) should reflect the project's identity. Keep the tone concise, helpful, and confident — the way a good CLI tool should feel.

## Key Concepts

- **Templates**: `.env.example` files containing secret references (`envi://`, `op://`, `pass://`)
- **Secret references**: `<scheme>://vault/item/field` format resolved via configured provider
- **`envi://` scheme**: Provider-agnostic — converted to native scheme (`op://`, `pass://`) at resolution time
- **Environment substitution**: `${ENV}` in references replaced at runtime (default: `local`)
- **3-way merge**: Template + resolved secrets + local overrides
- **One provider per invocation**: No multi-provider routing within a single run
- **Auto-discovery**: Globs for `**/<templateFile>`, no hardcoded paths. Monorepo-ready out of the box.
- **Config merge order**: defaults ← config file (`envi.json` via `--config`) ← CLI flags

## Architecture

- Command files use `.command.ts` suffix (`src/commands/*.command.ts`)
- `PROVIDER_DEFS` in `src/providers/index.ts` is the single source of truth for providers — all scheme constants, detection, and factory derive from it. Adding a provider = one entry there + `Provider` interface implementation.
- Provider constructors take `Record<string, string>` (not typed configs) so the CLI layer stays provider-agnostic. Provider-specific options flow through `--provider-opt key=value`.
- Zero config file required — works like any Unix tool with just flags + env vars.

## Code Style

- Be surgical with comments. Keep JSDoc on exports, "why" comments, and anything non-obvious. Only remove comments that literally restate the next line of code.
- Format with oxfmt (`.oxfmtrc.json`): no semis, single quotes, trailing commas, spaces, printWidth 120.
- Lint with oxlint (`.oxlintrc.json`): import + typescript plugins.

## Maintaining This File

If you discover a convention, pattern, or decision that isn't documented here but should be, ask the user whether to add it to AGENTS.md. Don't update it silently.
