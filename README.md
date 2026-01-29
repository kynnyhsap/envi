# envi

Manage `.env` files with secret providers. Sync secrets from 1Password into local `.env` files while preserving your local customizations.

## Table of Contents

- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Commands](#commands)
- [How It Works](#how-it-works)
  - [Templates](#templates-envtpl)
  - [Sync Flow](#sync-flow)
  - [Output Format](#output-format)
  - [Preserving Local Changes](#preserving-local-changes)
- [Adding New Templates](#adding-new-templates)
- [Environments](#environments)
  - [Supported Environments](#supported-environments)
  - [Template Syntax](#template-syntax)
  - [1Password Vault Structure](#1password-vault-structure)
  - [Usage](#usage)
  - [Flexible Patterns](#flexible-patterns)
- [1Password Secret References](#1password-secret-references)
- [Configured Paths](#configured-paths)
- [CI/CD Integration](#cicd-integration)
- [Backup System](#backup-system)
- [Development](#development)
- [Environment Variables](#environment-variables)

## Quick Start

```bash
# Show help
bun envi

# Check status (includes auth check)
bun envi status

# Show differences between local and provider
bun envi diff

# Sync .env files from templates
bun envi sync

# Force sync without prompts
bun envi sync -f

# Preview changes without writing
bun envi sync -d

# Validate all secret references
bun envi validate
```

## Prerequisites

**Authentication** - Choose one:

1. **1Password Desktop App** (recommended for local dev):
   - Install [1Password desktop app](https://1password.com/downloads/) (beta version required)
   - Enable **"Integrate with other apps"** in Settings > Developer
   - See: [Desktop App Integration](https://developer.1password.com/docs/sdks/desktop-app-integrations/)

2. **Service Account** (for CI/CD):
   - Set `OP_SERVICE_ACCOUNT_TOKEN` environment variable
   - See: [Service Accounts](https://developer.1password.com/docs/service-accounts/)

> **Note:** This CLI uses the [1Password JavaScript SDK](https://github.com/1Password/onepassword-sdk-js) directly, not the 1Password CLI tool.

## Commands

| Command    | Description                                                          |
| ---------- | -------------------------------------------------------------------- |
| `status`   | Show status and auth check                                           |
| `diff`     | Show differences between local `.env` and provider                   |
| `sync`     | Sync `.env` files from templates                                     |
| `backup`   | Backup all `.env` files (timestamped snapshots)                      |
| `restore`  | Restore `.env` files from backup (interactive)                       |
| `validate` | Validate `op://` reference format (use `--remote` to check provider) |

### Common Options

| Option             | Description                                                 |
| ------------------ | ----------------------------------------------------------- |
| `-d, --dry-run`    | Preview changes without writing files                       |
| `-f, --force`      | Skip confirmation prompts                                   |
| `-q, --quiet`      | Suppress non-essential output                               |
| `-e, --env <name>` | Environment (local, dev, staging, prod, sandbox, self-host) |
| `--account <name>` | 1Password account name for desktop app auth                 |
| `--only <paths>`   | Filter which paths to process                               |

## How It Works

### Templates (`.env.tpl`)

Templates are checked into git and contain `op://` references for secrets. Use `${ENV}` for environment-specific vaults:

```bash
# engine/api/.env.tpl
NODE_ENV=development
SECRET=op://core-${ENV}/engine-api/SECRET
DATABASE_URL=op://core-${ENV}/engine-api/DATABASE_URL
```

### Sync Flow

1. **Read template** - Parse `.env.tpl` file
2. **Resolve secrets** - Use 1Password SDK to fetch secrets
3. **Show changes** - Display table of NEW, UPDATED, UNCHANGED variables
4. **Confirm** - Prompt for confirmation if there are changes (skip with `--force`)
5. **Smart merge** - Combine with existing `.env`, preserving your customizations
6. **Write output** - Save merged result to `.env`

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

Custom variables are automatically placed at the end of the file below:

```bash
# ----------- PUT YOUR CUSTOM ENVS BELOW THIS LINE -----------
```

Example:

```bash
# You added: MY_CUSTOM_VAR=123
# After sync: MY_CUSTOM_VAR=123 (preserved below separator)
```

## Adding New Templates

1. Create a `.env.tpl` file in your package:

   ```bash
   # my-package/.env.tpl
   NODE_ENV=development
   API_KEY=op://core-${ENV}/my-package/API_KEY
   ```

2. Add the path to `ENV_PATHS` in `envi/src/config.ts`:

   ```typescript
   const ENV_PATHS = [
     'engine/api',
     'console',
     'my-package', // Add your package here
   ]
   ```

3. Create the 1Password item with required secrets

## Environments

The CLI supports multiple environments through the `-e, --env` flag. Use `${ENV}` in your op:// references to create environment-aware templates.

### Supported Environments

`local` (default), `dev`, `staging`, `prod`, `sandbox`, `self-host`

### Template Syntax

Use `${ENV}` anywhere in your op:// references:

```bash
# engine/api/.env.tpl

# Static values (no substitution)
NODE_ENV=development
PORT=3000

# Environment-specific secrets
SECRET=op://core-${ENV}/engine-api/SECRET
API_KEY=op://core-${ENV}/engine-api/API_KEY
DATABASE_URL=op://core-${ENV}/engine-api/DATABASE_URL
```

### 1Password Vault Structure

Create separate vaults per environment with a consistent prefix:

```
Vault: core-local
├── engine-api
│   ├── SECRET
│   └── DATABASE_URL
└── console

Vault: core-dev
├── engine-api
└── console

Vault: core-prod
├── engine-api
└── console
```

### Usage

```bash
# Local development (default)
bun envi sync

# Specific environment
bun envi sync -e dev
bun envi sync -e prod

# CI/CD
OP_SERVICE_ACCOUNT_TOKEN="..." bun envi sync -e prod -f -q
```

### Flexible Patterns

The `${ENV}` substitution is flexible - use it wherever makes sense for your vault structure:

```bash
# Env-prefixed vault (recommended)
op://core-${ENV}/engine-api/SECRET → op://core-prod/engine-api/SECRET

# Env-only vault
op://${ENV}/engine-api/SECRET → op://prod/engine-api/SECRET

# Env-prefixed item
op://core/${ENV}-engine-api/SECRET → op://core/prod-engine-api/SECRET

# Env in section
op://core/engine-api/${ENV}/SECRET → op://core/engine-api/prod/SECRET
```

## 1Password Secret References

Format: `op://vault/item[/section]/field`

Examples:

```bash
# Simple field
SECRET=op://core-local/engine-api/SECRET

# With environment variable
SECRET=op://core-${ENV}/engine-api/SECRET

# Section field
DB_PASSWORD=op://core-local/engine-api/database/password
```

See: [Secret Reference Syntax](https://developer.1password.com/docs/cli/secret-reference-syntax/)

## Configured Paths

Currently configured packages:

| Path              | Status       |
| ----------------- | ------------ |
| `dashboard-agent` | Has template |

To add more packages, see [Adding New Templates](#adding-new-templates).

## CI/CD Integration

For automated environments, use a 1Password Service Account.

### Local CI Testing

```bash
export OP_SERVICE_ACCOUNT_TOKEN="your-token"
bun envi sync --force
```

### GitHub Actions

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
        run: bun envi sync -e prod -f -q
```

### Resources

- [1Password JavaScript SDK](https://developer.1password.com/docs/sdks/) - SDK documentation
- [Service Accounts](https://developer.1password.com/docs/service-accounts/) - Create and manage service accounts
- [Desktop App Integration](https://developer.1password.com/docs/sdks/desktop-app-integrations/) - Local development setup

## Backup System

Backups are stored in timestamped directories under `.env-backup/`:

```
.env-backup/
├── 2024-01-27_14-30-00/
│   ├── engine/api/.env
│   └── console/.env
├── 2024-01-26_10-00-00/
│   └── engine/api/.env
```

### Managing Backups

```bash
# List all backup snapshots
bun envi restore --list

# Restore from most recent backup
bun envi restore -f
```

## Development

```bash
# Install dependencies
cd envi
bun install

# Run tests
bun test

# Run CLI directly
bun run src/cli.ts status
bun run src/cli.ts sync -d
bun run src/cli.ts backup -d
bun run src/cli.ts restore -d
bun run src/cli.ts validate
```

## Environment Variables

| Variable                   | Description                                    |
| -------------------------- | ---------------------------------------------- |
| `OP_SERVICE_ACCOUNT_TOKEN` | Service account token (overrides desktop auth) |
| `OP_ACCOUNT_NAME`          | 1Password account name (default: "Membrane")   |

### Authentication Priority

When authenticating with 1Password, the CLI uses this priority:

1. `OP_SERVICE_ACCOUNT_TOKEN` env var → Service account auth (for CI/CD)
2. `--account` CLI flag → Desktop app with specified account
3. `OP_ACCOUNT_NAME` env var → Desktop app with env var account
4. Default "Membrane" → Desktop app with default account