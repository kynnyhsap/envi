# envi

Manage `.env` files with 1Password. Sync secrets into local `.env` files while preserving your customizations.

## Table of Contents

- [Quick Start](#quick-start)
- [SDK](#sdk)
- [Secret References](#secret-references)
- [1Password](#1password)
- [Commands](#commands)
- [Examples](#examples)
- [How It Works](#how-it-works)
  - [Templates](#templates-envtpl)
  - [Sync Flow](#sync-flow)
  - [Output Format](#output-format)
  - [Preserving Local Changes](#preserving-local-changes)
- [Adding New Templates](#adding-new-templates)
- [Dynamic Vars](#dynamic-vars)
  - [Template Syntax](#template-syntax)
  - [Vault Structure](#vault-structure)
  - [Usage](#usage)
  - [Flexible Patterns](#flexible-patterns)
- [Configured Paths](#configured-paths)
- [CI/CD Integration](#cicd-integration)
- [Backup System](#backup-system)
- [Development](#development)
- [E2E Benchmark Vault](#e2e-benchmark-vault)
- [Environment Variables](#environment-variables)

## Quick Start

```bash
# Show help
envi

# Check status (includes auth check)
envi status

# Show differences between local and provider
envi diff

# Sync .env files from templates
envi sync

# Preview changes without writing
envi sync -d

# Validate all secret references
envi validate

# Resolve one secret reference directly
envi resolve --var PROFILE=default op://core-${PROFILE}/engine-api/SECRET

# Resolve multiple references (newline-separated output)
envi resolve --var PROFILE=default op://core-${PROFILE}/engine-api/SECRET op://core-${PROFILE}/engine-api/JWT_SECRET

# Run a command with secrets as env vars
envi run -- node index.js

# Machine-readable output (same envelope as SDK)
envi --json diff
```

## SDK

Envi also ships an SDK so you can reuse the exact same engine that powers the CLI.

- CLI `--json` output and SDK results share the same JSON envelope.
- SDK supports Bun + Node (auto-detected).
- By default, SDK results redact secret values in outputs intended for logging/automation.

```ts
import { createEnviEngine, createRuntimeAdapter, stringifyEnvelope } from 'envi-cli/sdk'

const engine = createEnviEngine({
  runtime: createRuntimeAdapter(),
  options: {
    vars: { PROFILE: 'local' },
  },
})

const result = await engine.diff()
process.stdout.write(stringifyEnvelope(result))
```

If you need secret values in SDK outputs (unsafe), pass `includeSecrets: true` to supported operations.

## Secret References

Envi uses native 1Password references in templates.

| Scheme  | Description                 | Example                 |
| ------- | --------------------------- | ----------------------- |
| `op://` | Native 1Password secret URI | `op://vault/item/field` |

Format: `op://vault/item[/section]/field`

## 1Password

Envi only supports 1Password. It can resolve secrets through the JavaScript SDK or the `op` CLI.

**Authentication** - Choose one:

1. **1Password Desktop App** (recommended for local dev):
   - Install [1Password desktop app](https://1password.com/downloads/)
   - Enable **"Integrate with other apps"** in Settings > Developer
   - See: [Desktop App Integration](https://developer.1password.com/docs/sdks/desktop-app-integrations/)

2. **Service Account** (for CI/CD):
   - Set `OP_SERVICE_ACCOUNT_TOKEN` environment variable
   - See: [Service Accounts](https://developer.1password.com/docs/service-accounts/)

**Backend selection** (optional):

```bash
# Default (SDK backend)
envi status

# Auto (SDK first, then CLI fallback)
envi status --provider-opt backend=auto

# Force CLI only
envi status --provider-opt backend=cli

# Force SDK only
envi status --provider-opt backend=sdk

# Use a specific op binary
envi status --provider-opt cliBinary=/usr/local/bin/op

# Secret resolution strategy tuning (1Password)
envi sync --provider-opt resolveMode=batch
envi sync --provider-opt resolveChunkSize=150
envi sync --provider-opt resolveConcurrency=12
```

**Performance provider options (1Password):**

- `resolveMode`: `auto` (default), `batch`, or `sequential`
  - `auto` prefers batched SDK resolution with fallback, and concurrent CLI resolution
  - `batch` forces batched SDK resolution and concurrent CLI resolution
  - `sequential` forces per-reference resolution (useful as a baseline)
- `resolveChunkSize`: chunk size for batched SDK calls (default: `100`)
- `resolveConcurrency`: max parallel resolves for CLI/fallback paths (default: `8`)

**Secret reference format:** `op://vault/item[/section]/field`

```bash
# Simple field
SECRET=op://core-local/engine-api/SECRET

# With dynamic vars
SECRET=op://core-${PROFILE}/engine-api/SECRET

# Section field
DB_PASSWORD=op://core-local/engine-api/database/password
```

**Resources:**

- [1Password JavaScript SDK](https://developer.1password.com/docs/sdks/)
- [Service Accounts](https://developer.1password.com/docs/service-accounts/)
- [Desktop App Integration](https://developer.1password.com/docs/sdks/desktop-app-integrations/)
- [Secret Reference Syntax](https://developer.1password.com/docs/cli/secret-reference-syntax/)

## Commands

| Command    | Description                                                         |
| ---------- | ------------------------------------------------------------------- |
| `status`   | Show status and auth check                                          |
| `diff`     | Show differences between local `.env` and provider                  |
| `sync`     | Sync `.env` files from templates                                    |
| `resolve`  | Resolve one or more secret references and print the secret values   |
| `run`      | Run a command with secrets injected as env vars                     |
| `backup`   | Backup current output files (`latest` plus archived snapshots)      |
| `restore`  | Restore output files from the latest or a specific backup snapshot  |
| `validate` | Validate secret reference format (use `--remote` to check provider) |

### Common Options

| Option                 | Description                                                         |
| ---------------------- | ------------------------------------------------------------------- |
| `-d, --dry-run`        | Preview changes without writing files                               |
| `-q, --quiet`          | Suppress non-essential output                                       |
| `--json`               | Output machine-readable JSON (same envelope as SDK)                 |
| `--var <NAME=value>`   | Dynamic reference variable (repeatable, default: `PROFILE=default`) |
| `--provider-opt <k=v>` | 1Password backend option (repeatable)                               |
| `--config <path>`      | Load config from JSON file                                          |
| `--only <paths>`       | Filter which paths to process                                       |
| `--template-file <f>`  | Override the template filename                                      |
| `--backup-dir <dir>`   | Override the backup directory                                       |
| `--snapshot <id>`      | Restore a specific backup snapshot id                               |

## Examples

- `examples/README.md` - quick index of the maintained examples
- `examples/1password-basic/` - simplest single-app setup
- `examples/1password-monorepo/` - auto-discovered multi-package setup
- `examples/1password-environments/` - `${PROFILE}` item-name switching inside one vault
- `examples/custom-files/` - custom template and output filenames
- `examples/1password-e2e-bench/` - live benchmark harness

Seed the shared example vaults with:

```bash
bun run examples:setup
```

Clean them up with:

```bash
bun run examples:cleanup
```

## How It Works

### Templates (`.env.example`)

Templates are checked into git and contain secret references. Use dynamic vars like `${PROFILE}` when you need reference switching:

```bash
# apps/api/.env.example
NODE_ENV=development
SECRET=op://core-${PROFILE}/engine-api/SECRET
DATABASE_URL=op://core-${PROFILE}/engine-api/DATABASE_URL
```

### Sync Flow

1. **Read template** - Parse `.env.example` file
2. **Resolve secrets** - Use 1Password to fetch secrets
3. **Show changes** - Display table of NEW, UPDATED, UNCHANGED variables
4. **Smart merge** - Combine with existing `.env`, preserving your customizations
5. **Write output** - Save merged result to `.env`

### JSON Output

When `--json` is enabled, Envi prints a stable JSON envelope intended for scripting.

- Core commands (`status`, `diff`, `sync`, `validate`, `resolve`, `run`, `backup`, `restore`) print the exact SDK envelope.
- Outputs stay redacted by default except when a command intentionally surfaces a secret, like `resolve`.

### Resolve Output

`resolve` supports one or more references.

```bash
# Single value
envi resolve --var PROFILE=default op://core-${PROFILE}/engine-api/SECRET

# Multiple values
envi resolve --var PROFILE=default op://core-${PROFILE}/engine-api/SECRET op://core-${PROFILE}/engine-api/JWT_SECRET
```

- Plain output prints one resolved value per line, in the same order as the input references.
- `--json` returns the normal SDK envelope; single-reference output uses `data.secret`, while multi-reference output uses `data.inputs` and `data.results`.

### Output Format

The sync command displays all variables in a table with two key columns:

| Source   | Status    | Description                                    |
| -------- | --------- | ---------------------------------------------- |
| TEMPLATE | NEW       | Variable from template, will be added          |
| TEMPLATE | UPDATED   | Secret changed in provider, will be updated    |
| TEMPLATE | UNCHANGED | Variable matches template, no changes needed   |
| CUSTOM   | KEPT      | Your custom variable, preserved below template |

Example output:

```
┌──────────┬───────────┬──────────────────────┬───────────────────────┐
│ Source   │ Status    │ Variable             │ Value                 │
├──────────┼───────────┼──────────────────────┼───────────────────────┤
│ TEMPLATE │ NEW       │ NEW_SECRET           │ abc...xyz             │
│ TEMPLATE │ UPDATED   │ API_KEY              │ def...uvw             │
│ TEMPLATE │ UNCHANGED │ APP_URL              │ http://localhost:3000 │
│ CUSTOM   │ KEPT      │ MY_DEBUG_FLAG        │ true                  │
└──────────┴───────────┴──────────────────────┴───────────────────────┘
```

When there are UPDATED variables, an additional "Old Value" column appears to show what's changing.

### Preserving Local Changes

The CLI preserves your local customizations:

- **Custom variables**: Variables not in the template are preserved and moved below a separator line
- **Template variables**: Always synced from the template (secrets from provider, defaults from template)

Generated `.env` files always include a managed header and keep custom variables below a separator:

```bash
# ───────── 🔑 Auto-generated by envi cli ─────────

# ──── 👇 PUT YOUR CUSTOM ENVS BELOW THIS LINE ────
```

Example:

```bash
# You added: MY_CUSTOM_VAR=123
# After sync: MY_CUSTOM_VAR=123 (preserved below separator)
```

## Adding New Templates

1. Create a `.env.example` file in your package:

   ```bash
   # my-package/.env.example
   NODE_ENV=development
   API_KEY=op://core-${PROFILE}/my-package/API_KEY
   ```

2. Envi auto-discovers templates by scanning for `**/.env.example` (monorepo-friendly).
   If you want to scope it down, use `--only` (or `paths` in config).

3. Create the corresponding item(s) in 1Password

## Dynamic Vars

The CLI supports repeatable dynamic reference vars through `--var NAME=value`. They are used to substitute placeholders like `${PROFILE}` inside secret references. When you use non-default vars, Envi saves them into the generated `.env` as metadata.

By default, Envi uses `PROFILE=default`.

### Template Syntax

Use `${NAME}` placeholders anywhere in your secret references:

```bash
# apps/api/.env.example

# Static values (no substitution)
NODE_ENV=development
PORT=3000

# Profile-specific secrets
SECRET=op://core-${PROFILE}/engine-api/SECRET
API_KEY=op://core-${PROFILE}/engine-api/API_KEY
DATABASE_URL=op://core-${PROFILE}/engine-api/DATABASE_URL
```

### Vault Structure

Create separate vaults per profile with a consistent prefix:

```
Vault: core-local
├── engine-api
│   ├── SECRET
│   └── DATABASE_URL
└── apps/web

Vault: core-dev
├── engine-api
└── apps/web

Vault: core-prod
├── engine-api
└── apps/web
```

### Usage

```bash
# Local development (default)
envi sync

# Specific profile
envi sync --var PROFILE=dev
envi sync --var PROFILE=prod

# Multiple vars
envi sync --var PROFILE=prod --var REGION=eu

# CI/CD (1Password)
OP_SERVICE_ACCOUNT_TOKEN="..." envi sync --var PROFILE=prod -q
```

### Flexible Patterns

Dynamic var substitution is flexible - use it wherever makes sense for your vault structure:

```bash
# Profile-prefixed vault (recommended)
op://core-${PROFILE}/engine-api/SECRET -> op://core-prod/engine-api/SECRET

# Profile-only vault
op://${PROFILE}/engine-api/SECRET -> op://prod/engine-api/SECRET

# Profile-prefixed item
op://core/${PROFILE}-engine-api/SECRET -> op://core/prod-engine-api/SECRET

# Multiple dynamic vars
op://core-${PROFILE}/engine-api/${REGION}/SECRET -> op://core-prod/engine-api/eu/SECRET
```

## Configured Paths

By default, Envi discovers templates automatically by scanning for `**/.env.example` from the current working directory.

To restrict which templates are processed:

```bash
# Only process a specific subdirectory
envi sync --only apps/api

# Multiple paths (comma-separated)
envi diff --only apps/api,apps/web
```

## CI/CD Integration

For automated environments, configure 1Password service account credentials.

### 1Password (Service Account)

```bash
export OP_SERVICE_ACCOUNT_TOKEN="your-token"
envi sync
```

### GitHub Actions (1Password)

```yaml
name: Setup Environment

on: [push]

jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install dependencies
        run: cd envi && bun install

      - name: Sync .env files
        env:
          OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
        run: envi sync --var PROFILE=prod -q
```

## Backup System

Backups are stored under `.env-backup/` and mirror your configured output filename (`.env` by default, but custom outputs like `.env.local` are backed up too):

```
.env-backup/
├── latest/
│   ├── .envi-backup.json
│   ├── apps/api/.env
│   └── apps/web/.env
├── 2026-03-07T15-39-54-840Z/
│   ├── .envi-backup.json
│   ├── apps/api/.env
│   └── apps/web/.env
├── 2026-03-06T10-00-00-000Z/
│   ├── .envi-backup.json
│   └── apps/api/.env
```

- `latest/` is always the most recent backup for quick restore and inspection.
- When a new backup is created, the previous `latest/` is archived to its timestamp id.
- Each snapshot stores metadata in `.envi-backup.json`.

### Managing Backups

```bash
# List all backup snapshots
envi restore --list

# List backups (same info)
envi backup --list

# Restore from the latest backup
envi restore

# Restore a specific archived snapshot
envi restore --snapshot 2026-03-07T15-39-54-840Z
```

## Development

```bash
# Install dependencies
cd envi
bun install

# Run tests
bun test
bun run test:e2e:1password

# Typecheck and lint
bun run typecheck
bun run lint

# Run CLI directly
bun run src/cli.ts status
bun run src/cli.ts sync -d
bun run src/cli.ts resolve op://vault/item/field
bun run src/cli.ts backup -d
bun run src/cli.ts restore -d
bun run src/cli.ts validate
```

## E2E Benchmark Vault

For live performance benchmarks against a real 1Password service account vault, use:

- `examples/1password-e2e-bench/README.md`

Quick run:

```bash
OP_SERVICE_ACCOUNT_TOKEN="..." bun run bench:e2e
```

## Environment Variables

| Variable                      | Description                                                 |
| ----------------------------- | ----------------------------------------------------------- |
| `OP_SERVICE_ACCOUNT_TOKEN`    | 1Password service account token (overrides desktop auth)    |
| `OP_ACCOUNT_NAME`             | 1Password account name/sign-in address for desktop auth     |
| `OP_CACHE`                    | 1Password CLI cache toggle (`true`/`false`, default `true`) |
| `ENVI_OP_RESOLVE_MODE`        | 1Password resolve strategy (`auto`, `batch`, `sequential`)  |
| `ENVI_OP_RESOLVE_CHUNK_SIZE`  | Chunk size for 1Password SDK `resolveAll` batching          |
| `ENVI_OP_RESOLVE_CONCURRENCY` | Max parallel 1Password fallback/CLI resolves                |

### Authentication Priority (1Password)

Default behavior (`--provider-opt backend=sdk`):

1. `OP_SERVICE_ACCOUNT_TOKEN` env var -> SDK service account auth (for CI/CD)
2. `--provider-opt accountName=<account>` or `OP_ACCOUNT_NAME` env var + desktop app running -> SDK desktop app auth
   - If unset, Envi will try to auto-detect a personal account from `op account list` (prefers `my.*`).

You can switch backends with `--provider-opt backend=cli` or `--provider-opt backend=sdk`.
