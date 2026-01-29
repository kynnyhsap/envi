# AGENTS.md

## Voice & Personality

Envi has a name — use it. All user-facing text (CLI output, logs, errors, docs) should reflect the project's identity. Keep the tone concise, helpful, and confident — the way a good CLI tool should feel.

## Project Overview

Envi is a CLI tool for managing `.env` files with 1Password as a secret provider.
It syncs secrets from `op://` references in template files, supports multiple environments,
and provides backup/restore, diff, and validation commands.

**Runtime:** Bun (runs TypeScript directly, no build step)
**Entry point:** `src/cli.ts` (Commander CLI with 6 subcommands)

## Commands

```bash
# Run the CLI
bun run src/cli.ts <command>

# Type checking
bun run typecheck          # uses tsgo --noEmit

# Run all tests
bun test

# Run a single test file
bun test src/utils/parse.test.ts

# Run tests matching a pattern
bun test --filter "parseEnvFile"
```

## Project Structure

```
src/
  cli.ts                    # CLI entry point (Commander setup)
  config.ts                 # Constants, paths, version
  sdk.ts                    # 1Password SDK wrapper
  logger.ts                 # Structured logging with picocolors
  commands/
    index.ts                # Barrel export
    status.ts               # Show env status & auth info
    diff.ts                 # Git-style diff between local .env and provider
    sync.ts                 # Resolve secrets, merge, write
    backup.ts               # Timestamped backup of .env files
    restore.ts              # Interactive restore from backups
    validate.ts             # Validate op:// references
  utils/
    index.ts                # Barrel export
    types.ts                # Core types: EnvVar, EnvFile, Change, ChangeType
    parse.ts                # Parse/serialize .env files
    secrets.ts              # isSecretReference() helper
    variables.ts            # Environment substitution (${ENV})
    diff.ts                 # computeChanges() between template/injected/local
    merge.ts                # mergeEnvFiles() - smart 3-way merge
    format.ts               # truncateValue, redactSecret, formatBackupTimestamp
    helpers.ts              # promptConfirm, withTimeout, checkPrerequisites
    paths.ts                # Path resolution for env dirs
  __tests__/
    cli.e2e.test.ts         # E2E tests for CLI commands
  utils/*.test.ts           # Unit tests colocated with source
```

## Code Style

### TypeScript Strictness

All strict flags are enabled in `tsconfig.json`:
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitReturns: true`
- `noUnusedLocals: true`, `noUnusedParameters: true`

### Formatting

- No semicolons
- Single quotes for strings
- Trailing commas
- 2-space indentation

### Naming Conventions

- `camelCase` for functions and variables
- `PascalCase` for types and interfaces
- `SCREAMING_SNAKE_CASE` for constants
- Descriptive names: `computeChanges`, `resolveTemplateSecrets`, `formatBackupTimestamp`

### Imports

- Named imports only, no default exports
- Barrel re-exports via `index.ts` files
- Relative paths without file extensions
- `node:` prefix for Node built-ins (e.g., `node:path`, `node:fs`)

```typescript
import { computeChanges } from '../utils'
import { resolve } from 'node:path'
```

### Types

- Interfaces preferred over type aliases for object shapes
- Explicit return types on exported functions
- `undefined` used explicitly in optional union types: `comment?: string | undefined`
- `Map` used for key-value collections instead of plain objects

### Error Handling

- `try/catch` with type narrowing:
  ```typescript
  catch (error) {
    log.error(error instanceof Error ? error.message : String(error))
  }
  ```
- Empty `catch {}` only for non-critical, intentionally silent failures
- `process.exit(1)` for fatal/unrecoverable errors

### Patterns

- `??` nullish coalescing preferred over `||` for defaults
- `for...of` loops preferred over `.forEach()`
- Bun APIs for file I/O: `Bun.file()`, `Bun.write()`, `Bun.$` (shell)
- `Bun.Glob` for file discovery
- `picocolors` for terminal colors (not chalk)
- `commander` for CLI framework
- `@inquirer/prompts` for interactive prompts

## Testing

Tests use Bun's built-in test runner (`bun:test`).

- **Unit tests** are colocated: `src/utils/parse.test.ts` next to `src/utils/parse.ts`
- **E2E tests** live in `src/__tests__/cli.e2e.test.ts`
- Tests requiring 1Password auth are marked with `describe.skip`
- Use `describe`/`it`/`expect` from `bun:test`
- Helper factories like `createEnvFile()` for test data
- E2E tests use `Bun.$` for workspace setup and `Bun.write`/`Bun.file` for file ops

```typescript
import { describe, it, expect } from 'bun:test'

describe('parseEnvFile', () => {
  it('should parse key-value pairs', () => {
    const result = parseEnvFile('KEY=value')
    expect(result.variables.size).toBe(1)
  })
})
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@1password/sdk` | 1Password secret resolution |
| `commander` | CLI framework |
| `@inquirer/prompts` | Interactive prompts |
| `picocolors` | Terminal colors |
| `console-table-printer` | Table output |
| `timeago.js` | Relative time formatting |

## Key Concepts

- **Templates**: `.env.template` files containing `op://` secret references
- **Secret references**: `op://vault/item/field` format resolved via 1Password
- **Environment substitution**: `${ENV}` in paths/values replaced at runtime
- **Environments**: local, dev, staging, prod, sandbox, self-host
- **3-way merge**: Template + resolved secrets + local overrides

## Maintaining This File

If you discover a convention, pattern, or decision that isn't documented here but should be, ask the user whether to add it to AGENTS.md. Don't update it silently.
