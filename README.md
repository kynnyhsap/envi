# envi

Manage `.env` files with secret providers. Sync secrets from 1Password, Proton Pass, or other providers into local `.env` files while preserving your local customizations.

## Table of Contents

- [Quick Start](#quick-start)
- [Secret References](#secret-references)
- [Providers](#providers)
  - [1Password](#1password)
  - [Proton Pass](#proton-pass)
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
  - [Vault Structure](#vault-structure)
  - [Usage](#usage)
  - [Flexible Patterns](#flexible-patterns)
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

# Run a command with secrets as env vars
bun envi run -- node index.js

# Use a specific provider
bun envi sync --provider proton-pass
```

## Secret References

Envi supports three URI schemes for secret references in templates:

| Scheme    | Description                                            | Example                   |
| --------- | ------------------------------------------------------ | ------------------------- |
| `envi://` | Universal format, routes to the default provider       | `envi://vault/item/field` |
| `op://`   | 1Password native format (auto-routes to 1Password)     | `op://vault/item/field`   |
| `pass://` | Proton Pass native format (auto-routes to Proton Pass) | `pass://vault/item/field` |

### Universal Format (`envi://`)

The `envi://` scheme is provider-agnostic. It maps to the configured default provider's native format:

```bash
# With --provider 1password (default):
# envi://core-local/engine-api/SECRET → op://core-local/engine-api/SECRET

# With --provider proton-pass:
# envi://core-local/engine-api/SECRET → pass://core-local/engine-api/SECRET
```

Format: `envi://vault/item/field`

### Backward Compatibility

Existing templates using `op://` references continue to work. They are automatically routed to the 1Password provider regardless of the default provider setting.

Similarly, `pass://` references always route to the Proton Pass provider.

## Providers

### 1Password

The recommended provider. Uses the [1Password JavaScript SDK](https://github.com/1Password/onepassword-sdk-js) directly.

**Authentication** - Choose one:

1. **1Password Desktop App** (recommended for local dev):
   - Install [1Password desktop app](https://1password.com/downloads/) (beta version required)
   - Enable **"Integrate with other apps"** in Settings > Developer
   - See: [Desktop App Integration](https://developer.1password.com/docs/sdks/desktop-app-integrations/)

2. **Service Account** (for CI/CD):
   - Set `OP_SERVICE_ACCOUNT_TOKEN` environment variable
   - See: [Service Accounts](https://developer.1password.com/docs/service-accounts/)

**Secret reference format:** `op://vault/item[/section]/field`

```bash
# Simple field
SECRET=op://core-local/engine-api/SECRET

# With environment variable
SECRET=op://core-${ENV}/engine-api/SECRET

# Section field
DB_PASSWORD=op://core-local/engine-api/database/password
```

**Resources:**

- [1Password JavaScript SDK](https://developer.1password.com/docs/sdks/)
- [Service Accounts](https://developer.1password.com/docs/service-accounts/)
- [Desktop App Integration](https://developer.1password.com/docs/sdks/desktop-app-integrations/)
- [Secret Reference Syntax](https://developer.1password.com/docs/cli/secret-reference-syntax/)

### Proton Pass

Uses the [Proton Pass CLI](https://proton.me/pass/download) (`pass-cli`) to resolve secrets.

**Prerequisites:**

1. Install `pass-cli` from [Proton Pass downloads](https://proton.me/pass/download)
2. Log in: `pass-cli login`
3. Verify: `pass-cli test`

**Secret reference format:** `pass://vault/item/field`

```bash
# Simple field
SECRET=pass://Production/engine-api/password

# With environment variable
SECRET=pass://core-${ENV}/engine-api/SECRET
```

**Field names:** `username`, `password`, `email`, `url`, `note`, `totp`, or any custom field name (case-sensitive).

**Usage:**

```bash
# Use Proton Pass as provider
bun envi sync --provider proton-pass

# Check auth status
bun envi status --provider proton-pass
```

## Commands

| Command    | Description                                                         |
| ---------- | ------------------------------------------------------------------- |
| `status`   | Show status and auth check                                          |
| `diff`     | Show differences between local `.env` and provider                  |
| `sync`     | Sync `.env` files from templates                                    |
| `run`      | Run a command with secrets injected as env vars                     |
| `backup`   | Backup all `.env` files (timestamped snapshots)                     |
| `restore`  | Restore `.env` files from backup (interactive)                      |
| `validate` | Validate secret reference format (use `--remote` to check provider) |

### Common Options

| Option                 | Description                                                     |
| ---------------------- | --------------------------------------------------------------- |
| `-d, --dry-run`        | Preview changes without writing files                           |
| `-f, --force`          | Skip confirmation prompts                                       |
| `-q, --quiet`          | Suppress non-essential output                                   |
| `-e, --env <name>`     | Environment name for `${ENV}` substitution (default: `default`) |
| `--provider <name>`    | Secret provider (1password, proton-pass)                        |
| `--provider-opt <k=v>` | Provider-specific option (repeatable)                           |
| `--config <path>`      | Load config from JSON file                                      |
| `--only <paths>`       | Filter which paths to process                                   |

## How It Works

### Templates (`.env.example`)

Templates are checked into git and contain secret references. Use `${ENV}` for environment-specific vaults:

```bash
# engine/api/.env.example
NODE_ENV=development
SECRET=envi://core-${ENV}/engine-api/SECRET
DATABASE_URL=envi://core-${ENV}/engine-api/DATABASE_URL
```

### Sync Flow

1. **Read template** - Parse `.env.example` file
2. **Resolve secrets** - Use the configured provider to fetch secrets
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

1. Create a `.env.example` file in your package:

   ```bash
   # my-package/.env.example
   NODE_ENV=development
   API_KEY=envi://core-${ENV}/my-package/API_KEY
   ```

2. Add the path to `ENV_PATHS` in `envi/src/config.ts`:

   ```typescript
   const ENV_PATHS = [
     'engine/api',
     'console',
     'my-package', // Add your package here
   ]
   ```

3. Create the corresponding item in your secret provider

## Environments

The CLI supports multiple environments through the `-e, --env` flag. Use `${ENV}` in your secret references to create environment-aware templates.

### Supported Environments

`local` (default), `dev`, `staging`, `prod`, `sandbox`, `self-host`

### Template Syntax

Use `${ENV}` anywhere in your secret references:

```bash
# engine/api/.env.example

# Static values (no substitution)
NODE_ENV=development
PORT=3000

# Environment-specific secrets
SECRET=envi://core-${ENV}/engine-api/SECRET
API_KEY=envi://core-${ENV}/engine-api/API_KEY
DATABASE_URL=envi://core-${ENV}/engine-api/DATABASE_URL
```

### Vault Structure

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

# CI/CD (1Password)
OP_SERVICE_ACCOUNT_TOKEN="..." bun envi sync -e prod -f -q

# Different provider
bun envi sync --provider proton-pass -e prod
```

### Flexible Patterns

The `${ENV}` substitution is flexible - use it wherever makes sense for your vault structure:

```bash
# Env-prefixed vault (recommended)
envi://core-${ENV}/engine-api/SECRET → envi://core-prod/engine-api/SECRET

# Env-only vault
envi://${ENV}/engine-api/SECRET → envi://prod/engine-api/SECRET

# Env-prefixed item
envi://core/${ENV}-engine-api/SECRET → envi://core/prod-engine-api/SECRET

# Env in section
envi://core/engine-api/${ENV}/SECRET → envi://core/engine-api/prod/SECRET
```

## Configured Paths

Currently configured packages:

| Path              | Status       |
| ----------------- | ------------ |
| `dashboard-agent` | Has template |

To add more packages, see [Adding New Templates](#adding-new-templates).

## CI/CD Integration

For automated environments, configure the appropriate provider credentials.

### 1Password (Service Account)

```bash
export OP_SERVICE_ACCOUNT_TOKEN="your-token"
bun envi sync --force
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
        run: bun envi sync -e prod -f -q
```

### Proton Pass (CI/CD)

```bash
# Log in via CLI first
pass-cli login
bun envi sync --provider proton-pass --force
```

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

| Variable                   | Description                                              |
| -------------------------- | -------------------------------------------------------- |
| `OP_SERVICE_ACCOUNT_TOKEN` | 1Password service account token (overrides desktop auth) |
| `OP_ACCOUNT_NAME`          | 1Password account name for desktop app auth              |

### Authentication Priority (1Password)

1. `OP_SERVICE_ACCOUNT_TOKEN` env var → Service account auth (for CI/CD)
2. `--provider-opt accountName=my-team` or `OP_ACCOUNT_NAME` env var → Desktop app auth
3. Error if none provided (account name is required for desktop app auth)
