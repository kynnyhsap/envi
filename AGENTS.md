# AGENTS.md

Envi is a CLI + SDK for syncing and running with `.env` secrets (no manual copy/paste).

**Package manager:** Bun
**Runtimes:** CLI (Bun), SDK (Bun + Node)

**Type check:** `bun run typecheck`
**Test:** `bun test`
**Live E2E:** `bun run test:e2e:1password` (uses repo-root `.env.test` or `.env.local`)
**Benchmark:** `bun run bench:e2e` (requires local `.env.local` token)
**Seed example vaults:** `bun run examples:setup` (requires local `.env.local` token)
**Cleanup example vaults:** `bun run examples:cleanup` (requires local `.env.local` token)
**Run CLI:** `bun run src/cli.ts <command>`
**Build SDK (publish):** `bun run build:sdk`

**Config:** load `envi.json` by default if present; override with `--config <path>`.

## Testing

- Local/unit/integration coverage runs with `bun test`
- CLI local E2E lives in `src/cli/cli.e2e.test.ts`
- Live 1Password E2E lives in `src/cli/cli.1password.live.e2e.ts`
- Live E2E loads repo-root `.env.test` first, then `.env.local`
- Prefer E2E for CLI/SDK behavior: put command-level behavior in `cli.e2e` or `cli.1password.live.e2e`, not mocked provider/unit tests.
- Keep mocks limited to pure/singular logic (parsers, formatters, small helpers). Do not add mock-heavy tests for end-user command flows.
- Keep skipped tests at zero; if a case requires provider auth, move it to live E2E instead of `describe.skip`.
- Treat maintained `examples/` as test targets; keep their core flows covered in live E2E.
- Temporary guardrail until CI backend matrix is broader: for provider wiring changes, add or update live E2E for `--provider-opt` behavior (backend/resolve mode), not only provider mocks.
- When making code changes, run the smallest relevant test slice first, then run the broader suite before calling the work done
- When doing a refactor or touching CLI/SDK/runtime/provider wiring, always run at least `bun run typecheck`, `bun test`, and `bun run lint`
- When changing critical 1Password flows (`status`, `diff`, `sync`, `validate`, `resolve`, `run`, `backup`, `restore`) or shared CLI parsing/config behavior, also run `bun run test:e2e:1password` unless the user explicitly asks not to or required credentials are unavailable

## Config and Precedence

- Default config filename: `envi.json` (auto-loaded when present)
- Override: `--config <path>` (JSON)
- Merge order: defaults <- config file <- CLI flags
- Provider options flow through `--provider-opt key=value` (repeatable) and are treated as a string map
- `--only <paths>` scopes discovery/processing to specific directories (comma-separated)

## Architecture

- Core commands (`status`, `diff`, `sync`, `validate`, `resolve`, `run`) are SDK-backed; keep `src/cli/commands/*.ts` as presenters.
- Envi is 1Password-only today. Keep the provider boundary intact, but assume a single `OnePasswordProvider` behind it.
- Provider options still flow as `Record<string, string>` so CLI/SDK wiring stays simple and extensible.
- Process/platform boundaries shared across CLI/SDK/providers live in `src/shared/process/*` and `src/sdk/runtime/*` (avoid provider -> SDK imports to prevent cycles).
- Canonical machine output is the SDK JSON envelope (`src/sdk/json.ts`); CLI `--json` prints it directly (no reshaping).
- SDK results are safe by default (redacted); operations that surface values support `includeSecrets` as an explicit escape hatch.
- CLI flows are non-interactive by default. Prefer `--dry-run` for previewing changes; do not add confirmation prompts back unless explicitly requested.

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
- `examples/` should stay small, 1Password-only, and limited to real supported workflows.
- Local-only service account tokens live in repo-root `.env.test` or `.env.local` (both gitignored).
