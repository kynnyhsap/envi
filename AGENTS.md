# AGENTS.md

Envi is a CLI + SDK for syncing and running with `.env` secrets (no manual copy/paste).

**Package manager:** Bun
**Runtimes:** CLI (Bun), SDK (Bun + Node)

**Type check:** `bun run typecheck`
**Test:** `bun test`
**Run CLI:** `bun run src/cli.ts <command>`
**Build SDK (publish):** `bun run build:sdk`

**Config:** load `envi.json` by default if present; override with `--config <path>`.

## Config and Precedence

- Default config filename: `envi.json` (auto-loaded when present)
- Override: `--config <path>` (JSON)
- Merge order: defaults <- config file <- CLI flags
- Provider options flow through `--provider-opt key=value` (repeatable) and are treated as a string map
- `--only <paths>` scopes discovery/processing to specific directories (comma-separated)

## Architecture

- Core commands (`status`, `diff`, `sync`, `validate`, `resolve`, `run`) are SDK-backed; keep `src/commands/*.command.ts` as presenters.
- Envi is 1Password-only today. Keep the provider boundary intact, but assume a single `OnePasswordProvider` behind it.
- Provider options still flow as `Record<string, string>` so CLI/SDK wiring stays simple and extensible.
- Platform boundaries shared across CLI/SDK/providers live in `src/runtime/*` (avoid provider -> SDK imports to prevent cycles).
- Canonical machine output is the SDK JSON envelope (`src/sdk/json.ts`); CLI `--json` prints it directly (no reshaping).
- SDK results are safe by default (redacted); operations that surface values support `includeSecrets` as an explicit escape hatch.

## 1Password Scope

- Supported secret reference format: `op://vault/item[/section]/field`
- Supported backends: 1Password JS SDK + `op` CLI
- `references/` may contain old provider research; treat it as archive material unless the code says otherwise.

## Runtime and Filesystem Patterns

- Prefer async filesystem APIs; avoid sync node:fs calls.
- Avoid TOCTOU patterns like `existsSync(path)` then `statSync(path)`; use one operation and handle `ENOENT` via `try/catch`.
- Avoid `readFileSync(path).slice(0, max)`; it reads the full file into memory.
- For deletions, prefer `rm(path, { recursive: true, force: true })` over manual unlink loops.
- A conventions test (`src/conventions/fs-usage.test.ts`) enforces that sync fs anti-patterns are not introduced.

## Style

- Format: `bun run fmt` (oxfmt)
- Lint: `bun run lint` (oxlint)

## Notes

- Code-adjacent `AGENTS.md` files under `src/**/` contain module-specific quirks and are loaded automatically when working in those areas.
