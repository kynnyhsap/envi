# Proton Pass CLI Reference

> Source: https://protonpass.github.io/pass-cli/
> GitHub: https://github.com/protonpass/pass-cli
> Status: Beta

## Documentation Links

- [Overview](https://protonpass.github.io/pass-cli/)
- [Installation](https://protonpass.github.io/pass-cli/get-started/installation/)
- [Configuration](https://protonpass.github.io/pass-cli/get-started/configuration/)
- Object types: [Share](https://protonpass.github.io/pass-cli/objects/share/) | [Vault](https://protonpass.github.io/pass-cli/objects/vault/) | [Item](https://protonpass.github.io/pass-cli/objects/item/)
- Secret management: [Secret references](https://protonpass.github.io/pass-cli/commands/contents/secret-references/) | [view](https://protonpass.github.io/pass-cli/commands/contents/view/) | [run](https://protonpass.github.io/pass-cli/commands/contents/run/) | [inject](https://protonpass.github.io/pass-cli/commands/contents/inject/)
- Commands: [login](https://protonpass.github.io/pass-cli/commands/login/) | [logout](https://protonpass.github.io/pass-cli/commands/logout/) | [info](https://protonpass.github.io/pass-cli/commands/info/) | [test](https://protonpass.github.io/pass-cli/commands/test/) | [user](https://protonpass.github.io/pass-cli/commands/user/) | [settings](https://protonpass.github.io/pass-cli/commands/settings/) | [share](https://protonpass.github.io/pass-cli/commands/share/) | [vault](https://protonpass.github.io/pass-cli/commands/vault/) | [item](https://protonpass.github.io/pass-cli/commands/item/) | [invite](https://protonpass.github.io/pass-cli/commands/invite/) | [password](https://protonpass.github.io/pass-cli/commands/password/) | [ssh-agent](https://protonpass.github.io/pass-cli/commands/ssh-agent/) | [update](https://protonpass.github.io/pass-cli/commands/update/)
- Help: [FAQ](https://protonpass.github.io/pass-cli/help/faq/) | [Troubleshooting](https://protonpass.github.io/pass-cli/help/troubleshoot/)

---

## Installation

**macOS/Linux:**

```bash
curl -fsSL https://proton.me/download/pass-cli/install.sh | bash
```

**macOS (Homebrew):**

```bash
brew install protonpass/tap/pass-cli
```

**Windows:**

```powershell
Invoke-WebRequest -Uri https://proton.me/download/pass-cli/install.ps1 -OutFile install.ps1; .\install.ps1
```

Custom install dir: `export PROTON_PASS_CLI_INSTALL_DIR=/custom/path`
Beta channel: `export PROTON_PASS_CLI_INSTALL_CHANNEL=beta`

**Supported platforms:** macOS (x86_64, arm64), Linux (x86_64, aarch64), Windows (x86_64)

---

## Authentication

### Web Login (default, supports SSO and hardware keys)

```bash
pass-cli login
```

Opens a URL in browser to complete auth flow.

### Interactive Login

```bash
pass-cli login --interactive [USERNAME]
```

Prompts for password, TOTP (if enabled), and extra password (if configured).

### Credential Environment Variables

Each credential checks in order: env var → file from env var → interactive prompt.

| Credential | Env var | File env var |
|---|---|---|
| Password | `PROTON_PASS_PASSWORD` | `PROTON_PASS_PASSWORD_FILE` |
| TOTP | `PROTON_PASS_TOTP` | `PROTON_PASS_TOTP_FILE` |
| Extra password | `PROTON_PASS_EXTRA_PASSWORD` | `PROTON_PASS_EXTRA_PASSWORD_FILE` |

### Session Management

```bash
pass-cli test    # Verify auth works (exit code 0 = ok)
pass-cli info    # Show user ID, username, email, release track
pass-cli logout  # End session, clear local data
pass-cli logout --force  # Force local cleanup even if remote logout fails
```

Sessions persist across terminal sessions until explicit logout.

---

## Configuration

### Environment Variables

| Variable | Description |
|---|---|
| `PASS_LOG_LEVEL` | Log verbosity: `trace`, `debug`, `info`, `warn`, `error`, `off`. Logs go to stderr. |
| `PROTON_PASS_SESSION_DIR` | Override session storage directory |
| `PROTON_PASS_KEY_PROVIDER` | Key storage backend: `keyring` (default), `fs`, `env` |
| `PROTON_PASS_ENCRYPTION_KEY` | Encryption key (required when `KEY_PROVIDER=env`) |
| `PROTON_PASS_DISABLE_TELEMETRY` | Disable anonymous telemetry if set |
| `PROTON_PASS_NO_UPDATE_CHECK` | Disable automatic update checks if set |

### Key Storage Backends

| Backend | Config | Use case | Persists reboot? |
|---|---|---|---|
| `keyring` (default) | unset or `PROTON_PASS_KEY_PROVIDER=keyring` | Local dev (macOS Keychain, Windows Credential Manager, Linux kernel keyring) | Linux: No. Others: Yes |
| `fs` | `PROTON_PASS_KEY_PROVIDER=fs` | Docker, headless, CI. Key stored as `<session-dir>/local.key` (0600) | Yes |
| `env` | `PROTON_PASS_KEY_PROVIDER=env` + `PROTON_PASS_ENCRYPTION_KEY=<value>` | CI/CD, containers. Value is SHA256-hashed to derive 256-bit key | N/A |

When switching key provider, logout first: `pass-cli logout --force`

### Persistent Settings

```bash
pass-cli settings view                                       # Show all settings
pass-cli settings set default-vault --vault-name "MyVault"   # Set default vault
pass-cli settings set default-format json                    # Set default output format
pass-cli settings unset default-vault                        # Clear default vault
pass-cli settings unset default-format                       # Clear default format
```

Default vault affects: `item list`, `item view`, `item create`, `item update`, `item totp`, `item trash/untrash`, `item move`.
Default format affects: `item list`, `item view`, `item totp`, `vault list`.

---

## Data Model

### Shares

A **Share** represents a user's access relationship to a resource (vault or item). Each share has a unique ID. When a vault is shared with another user, they get a different share ID pointing to the same vault.

**Types:** Vault shares (access to entire vault + all items) and Item shares (access to single item).

**Roles:** `viewer` (read-only), `editor` (read/write items), `manager` (full control + sharing), `owner` (creator, can delete vault).

### Vaults

Container for items. Each item belongs to exactly one vault. Operations: create, list, update (rename), delete, share, manage members, transfer ownership.

### Items

Fundamental data unit. Types: Login, Note, Credit Card, Identity, Alias, SSH Key, WiFi.

**Item ID is only unique in combination with Share ID.**

Common login fields: `username`, `password`, `email`, `url`, `note`, `totp`.

---

## Secret References

### Format

```
pass://<vault-identifier>/<item-identifier>/<field-name>
```

All three components are required. Names with spaces are supported. Case-sensitive.

- **vault-identifier**: Share ID or vault name
- **item-identifier**: Item ID or item title
- **field-name**: `username`, `password`, `email`, `url`, `note`, `totp`, or any custom field name

### Examples

```
pass://Work/GitHub/password
pass://Personal/Email Login/username
pass://AbCdEf123456/XyZ789/password
pass://My Vault/My Item/My Custom Field
```

Names vs IDs: vault and item can each be referenced by name or ID. If duplicate names exist, first match is used. For guaranteed uniqueness, use Share ID + Item ID.

### Invalid Formats

```
pass://vault/item              # Missing field name
pass://vault/item/             # Trailing slash
pass://vault/                  # Missing item and field
pass://                        # Empty reference
```

---

## Secret Resolution Commands

### view — Read a single secret

```bash
# By URI (preferred for scripting)
pass-cli item view "pass://vault/item/field"

# By name
pass-cli item view --vault-name "Work" --item-title "GitHub" --field "password"

# By ID
pass-cli item view --share-id "abc123" --item-id "item456" --field "password"

# Full item details
pass-cli item view --share-id "abc123" --item-id "item456"

# JSON output
pass-cli item view --share-id "abc123" --item-id "item456" --output json
```

Options `--share-id`/`--vault-name` and `--item-id`/`--item-title` are mutually exclusive pairs. Both pairs are mutually exclusive with URI argument.

### run — Inject secrets into environment variables

```bash
pass-cli run [--env-file FILE]... [--no-masking] -- COMMAND [ARGS...]
```

Scans env vars (process + `--env-file` files) for bare `pass://` URIs, resolves them, replaces values, then executes the command. Secrets are masked in stdout/stderr by default (`<concealed by Proton Pass>`).

```bash
# From env vars
export DB_PASSWORD='pass://Production/Database/password'
pass-cli run -- ./my-app

# From .env files (later files override earlier)
pass-cli run --env-file .env.base --env-file .env.secrets -- node server.js

# Disable masking
pass-cli run --no-masking -- ./my-app
```

Multiple `pass://` references in a single value are supported:

```
DATABASE_URL="postgresql://user:pass://vault/db/password@localhost/db"
```

The command forwards stdin/stdout/stderr and signals (SIGTERM/SIGINT) to the child process.

### inject — Template file processing

```bash
pass-cli inject [--in-file FILE] [--out-file FILE] [--force] [--file-mode MODE]
```

Reads template, replaces `{{ pass://vault/item/field }}` patterns (handlebars-style) with resolved values. Bare `pass://` URIs outside `{{ }}` are ignored.

```bash
# File to file
pass-cli inject --in-file template.yaml --out-file config.yaml

# File to stdout
pass-cli inject --in-file template.yaml

# Stdin to stdout
cat template.txt | pass-cli inject

# Overwrite + custom permissions
pass-cli inject --in-file tpl.txt --out-file out.txt --force --file-mode 0644
```

Default file mode: `0600`.

Template example:

```yaml
database:
  username: {{ pass://Production/Database/username }}
  password: {{ pass://Production/Database/password }}
# This pass://fake/uri in a comment is ignored
```

---

## Vault Operations

```bash
pass-cli vault list [--output human|json]
pass-cli vault create --name "NAME"
pass-cli vault update (--share-id ID | --vault-name NAME) --name "NEW_NAME"
pass-cli vault delete (--share-id ID | --vault-name NAME)        # Permanent!
pass-cli vault share (--share-id ID | --vault-name NAME) EMAIL [--role viewer|editor|manager]
pass-cli vault transfer (--share-id ID | --vault-name NAME) MEMBER_SHARE_ID

# Member management
pass-cli vault member list (--share-id ID | --vault-name NAME) [--output FORMAT]
pass-cli vault member update --share-id ID --member-share-id MID --role ROLE
pass-cli vault member remove --share-id ID --member-share-id MID
```

---

## Item Operations

### List

```bash
pass-cli item list [VAULT_NAME] [--share-id ID] [--output FORMAT]
```

### Create Login

```bash
pass-cli item create login \
  (--share-id ID | --vault-name NAME) \
  --title "Title" \
  [--username USER] [--email EMAIL] [--password PASS] \
  [--generate-password[="length,uppercase,symbols"]] \
  [--generate-passphrase[="word_count"]] \
  [--url URL]...

# From template
pass-cli item create login --get-template > template.json
pass-cli item create login --from-template template.json --share-id ID

# Template JSON format:
# {"title":"...","username":"...","email":"...","password":"...","urls":["..."]}
```

### Create SSH Key

```bash
# Generate new
pass-cli item create ssh-key generate \
  (--share-id ID | --vault-name NAME) \
  --title "Title" [--key-type ed25519|rsa2048|rsa4096] [--comment "..."] [--password]

# Import existing
pass-cli item create ssh-key import \
  --from-private-key PATH \
  (--share-id ID | --vault-name NAME) \
  --title "Title" [--password]
```

SSH key passphrase env vars: `PROTON_PASS_SSH_KEY_PASSWORD`, `PROTON_PASS_SSH_KEY_PASSWORD_FILE`.

### View

```bash
pass-cli item view "pass://vault/item/field"
pass-cli item view (--share-id ID | --vault-name NAME) (--item-id ID | --item-title TITLE) [--field FIELD] [--output FORMAT]
```

### Update

```bash
pass-cli item update \
  (--share-id ID | --vault-name NAME) \
  (--item-id ID | --item-title TITLE) \
  --field "name=value" [--field "name=value"]...
```

Standard fields: `title`, `username`, `password`, `email`, `url`, `note`. Any other name creates/updates a custom field.

### Delete / Share / TOTP

```bash
pass-cli item delete --share-id ID --item-id ID                   # Permanent!
pass-cli item share --share-id ID --item-id ID EMAIL [--role ROLE]
pass-cli item totp "pass://vault/item[/field]" [--output FORMAT]
```

### Alias

```bash
pass-cli item alias create (--share-id ID | --vault-name NAME) --prefix "PREFIX" [--output FORMAT]
```

### Attachment

```bash
pass-cli item attachment download --share-id ID --item-id ID --attachment-id AID
```

---

## Share Operations

```bash
pass-cli share list [--output human|json]
```

Lists all shares (vault + item) with type, role, and name.

---

## Invite Operations

```bash
pass-cli invite list [--output human|json]
pass-cli invite accept --invite-token TOKEN
pass-cli invite reject --invite-token TOKEN
```

---

## Password Utilities

No auth required.

```bash
# Generate random password
pass-cli password generate random [--length N] [--numbers BOOL] [--uppercase BOOL] [--symbols BOOL]

# Generate passphrase
pass-cli password generate passphrase [--count N] [--separator hyphens] [--capitalize BOOL] [--numbers BOOL]

# Score password strength
pass-cli password score "PASSWORD" [--output human|json]
# JSON output: {"numeric_score": 51.6, "password_score": "Vulnerable", "penalties": ["ContainsCommonPassword"]}
```

---

## SSH Agent

### Load keys into existing agent

```bash
pass-cli ssh-agent load [--share-id ID | --vault-name NAME]
```

Requires `SSH_AUTH_SOCK` to be set. Scans vaults for SSH key items and loads them.

### Run as standalone SSH agent

```bash
pass-cli ssh-agent start \
  [--share-id ID | --vault-name NAME] \
  [--socket-path PATH] \
  [--refresh-interval SECONDS] \
  [--create-new-identities VAULT_NAME_OR_ID]
```

Default socket: `~/.ssh/proton-pass-agent.sock`. Default refresh: 3600s.

After starting, export the socket in other terminals:

```bash
export SSH_AUTH_SOCK=~/.ssh/proton-pass-agent.sock
ssh-add -L  # Verify keys are loaded
```

With `--create-new-identities`, keys added via `ssh-add` are auto-saved to the specified vault.

---

## Update

```bash
pass-cli update [--yes] [--set-track stable|beta]
```

Only works for manual installations (not Homebrew/package managers). Auto-checks for updates every 3 days.

---

## CI/CD Usage

For headless/container environments:

```bash
# Use filesystem key storage
export PROTON_PASS_KEY_PROVIDER=fs
# Or use env var key storage
export PROTON_PASS_KEY_PROVIDER=env
export PROTON_PASS_ENCRYPTION_KEY="$(dd if=/dev/urandom bs=1 count=2048 2>/dev/null | sha256sum | awk '{print $1}')"

# Automated login
export PROTON_PASS_PASSWORD='...'
export PROTON_PASS_TOTP='...'
pass-cli login --interactive user@proton.me

# Use secrets
pass-cli run --env-file .env.production -- ./deploy.sh

# Cleanup
pass-cli logout
```

---

## Comparison with 1Password CLI

| Feature | 1Password (`op://`) | Proton Pass (`pass://`) |
|---|---|---|
| URI scheme | `op://vault/item/field` | `pass://vault/item/field` |
| Resolution | SDK (`client.secrets.resolve()`) | CLI (`pass-cli item view`) |
| Inject syntax | N/A (SDK only) | `{{ pass://... }}` in templates |
| Run with env | N/A | `pass-cli run -- cmd` |
| Auth | SDK token / Desktop app | Web login / Interactive CLI |
| Vault ID | vault name | Share ID or vault name |
| Batch resolve | SDK loop | CLI loop (no batch API) |
| Output masking | N/A | Default on, `--no-masking` to disable |
