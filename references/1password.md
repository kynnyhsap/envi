# 1Password Reference

Comprehensive reference for working with 1Password CLI (`op`) and the JavaScript SDK (`@1password/sdk`).

## Documentation Index

### Getting Started

| Topic                 | URL                                                  |
| --------------------- | ---------------------------------------------------- |
| CLI Overview          | https://developer.1password.com/docs/cli/            |
| Use Cases             | https://developer.1password.com/docs/cli/use-cases   |
| Get Started (Install) | https://developer.1password.com/docs/cli/get-started |
| Example Scripts       | https://developer.1password.com/docs/cli/scripts     |

### Configuration

| Topic              | URL                                                         |
| ------------------ | ----------------------------------------------------------- |
| Verify Installer   | https://developer.1password.com/docs/cli/verify             |
| Install on Server  | https://developer.1password.com/docs/cli/install-server     |
| Config Directories | https://developer.1password.com/docs/cli/config-directories |
| Check for Updates  | https://developer.1password.com/docs/cli/reference/update   |
| Uninstall          | https://developer.1password.com/docs/cli/uninstall          |

### Authentication & Sign-in

| Topic                        | URL                                                            |
| ---------------------------- | -------------------------------------------------------------- |
| App Integration (Biometrics) | https://developer.1password.com/docs/cli/app-integration       |
| Sign in Manually             | https://developer.1password.com/docs/cli/sign-in-manually      |
| Sign in with SSO             | https://developer.1password.com/docs/cli/sign-in-sso           |
| Multiple Accounts            | https://developer.1password.com/docs/cli/use-multiple-accounts |

### CLI Command Reference

| Command              | URL                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------- |
| Reference Overview   | https://developer.1password.com/docs/cli/reference                                     |
| Best Practices       | https://developer.1password.com/docs/cli/best-practices                                |
| `op account`         | https://developer.1password.com/docs/cli/reference/management-commands/account         |
| `op connect`         | https://developer.1password.com/docs/cli/reference/management-commands/connect         |
| `op document`        | https://developer.1password.com/docs/cli/reference/management-commands/document        |
| `op events-api`      | https://developer.1password.com/docs/cli/reference/management-commands/events-api      |
| `op group`           | https://developer.1password.com/docs/cli/reference/management-commands/group           |
| `op item`            | https://developer.1password.com/docs/cli/reference/management-commands/item            |
| `op plugin`          | https://developer.1password.com/docs/cli/reference/management-commands/plugin          |
| `op service-account` | https://developer.1password.com/docs/cli/reference/management-commands/service-account |
| `op user`            | https://developer.1password.com/docs/cli/reference/management-commands/user            |
| `op vault`           | https://developer.1password.com/docs/cli/reference/management-commands/vault           |
| `op completion`      | https://developer.1password.com/docs/cli/reference/commands/completion                 |
| `op inject`          | https://developer.1password.com/docs/cli/reference/commands/inject                     |
| `op read`            | https://developer.1password.com/docs/cli/reference/commands/read                       |
| `op run`             | https://developer.1password.com/docs/cli/reference/commands/run                        |
| `op signin`          | https://developer.1password.com/docs/cli/reference/commands/signin                     |
| `op signout`         | https://developer.1password.com/docs/cli/reference/commands/signout                    |
| `op update`          | https://developer.1password.com/docs/cli/reference/commands/update                     |
| `op whoami`          | https://developer.1password.com/docs/cli/reference/commands/whoami                     |

### Concepts & Reference

| Topic                   | URL                                                              |
| ----------------------- | ---------------------------------------------------------------- |
| Environment Variables   | https://developer.1password.com/docs/cli/environment-variables   |
| Item Fields             | https://developer.1password.com/docs/cli/item-fields             |
| Item JSON Template      | https://developer.1password.com/docs/cli/item-template-json      |
| Secret Reference Syntax | https://developer.1password.com/docs/cli/secret-reference-syntax |
| Template Syntax         | https://developer.1password.com/docs/cli/secrets-template-syntax |
| Vault Permissions       | https://developer.1password.com/docs/cli/vault-permissions       |
| User States             | https://developer.1password.com/docs/cli/user-states             |

### Security & Integration

| Topic                    | URL                                                               |
| ------------------------ | ----------------------------------------------------------------- |
| App Integration Security | https://developer.1password.com/docs/cli/app-integration-security |
| Use with Connect Server  | https://developer.1password.com/docs/connect/cli                  |

### SDK Documentation

| Topic                           | URL                                                                |
| ------------------------------- | ------------------------------------------------------------------ |
| SDK Overview                    | https://developer.1password.com/docs/sdks                          |
| Desktop App Integrations (beta) | https://developer.1password.com/docs/sdks/desktop-app-integrations |
| Load Secrets                    | https://developer.1password.com/docs/sdks/load-secrets             |
| Manage Items                    | https://developer.1password.com/docs/sdks/manage-items             |
| Manage Files                    | https://developer.1password.com/docs/sdks/files                    |
| Share Items                     | https://developer.1password.com/docs/sdks/share-items              |
| List Vaults & Items             | https://developer.1password.com/docs/sdks/list-vaults-items        |
| Manage Vaults (beta)            | https://developer.1password.com/docs/sdks/vaults                   |
| Manage Groups (beta)            | https://developer.1password.com/docs/sdks/groups                   |
| Supported Functionality         | https://developer.1password.com/docs/sdks/functionality            |
| Concepts                        | https://developer.1password.com/docs/sdks/concepts                 |
| JavaScript SDK (GitHub)         | https://github.com/1Password/onepassword-sdk-js/                   |

### Other

| Topic         | URL                                                    |
| ------------- | ------------------------------------------------------ |
| Release Notes | https://app-updates.agilebits.com/product_history/CLI2 |

---

## Secret Reference Syntax

The `op://` URI format points to a secret stored in 1Password:

```
op://vault/item/field
op://vault/item/section/field
```

- Case-insensitive
- Supports: alphanumeric, `-`, `_`, `.`, whitespace (quote refs with spaces)
- Unsupported characters require using the item's unique ID instead of name
- File attachments: use file name in place of field name

### Query parameters

```
op://vault/item/field?attribute=otp       # get one-time password
op://vault/item/field?attribute=type      # get field type
op://vault/item/key?ssh-format=openssh    # SSH key in OpenSSH format
```

### Variables in references

Use externally-set variables to switch between environments:

```
op://${APP_ENV}/api/credentials/key
```

Set `APP_ENV=dev` or `APP_ENV=prod` to resolve to different vaults.

### Template syntax (for `op inject`)

Secret references in template files can be:

- **Unenclosed**: `op://vault/item/field` — ends at first unsupported character
- **Enclosed**: `{{ op://vault/item/field }}` — wrapped in `{{ }}`

Variables: `$VAR` or `${VAR}` (replaced from environment)
Default values: `${VAR:-default}`

---

## CLI Authentication Methods

### 1. Desktop App Integration (recommended)

- Enable in 1Password app: **Settings > Developer > Integrate with 1Password CLI**
- Authenticates via biometrics (Touch ID, Windows Hello, system auth)
- Sessions auto-refresh, expire after 10 min inactivity, hard limit 12 hours
- Per-terminal-session authorization on macOS/Linux
- Toggle: `OP_BIOMETRIC_UNLOCK_ENABLED=true|false`

### 2. Service Account Token

- Set `OP_SERVICE_ACCOUNT_TOKEN` environment variable
- Scoped to specific vaults (principle of least privilege)
- Best for CI/CD, servers, automated scripts
- No interactive auth needed

### 3. Manual Sign-in

- `op account add` then `eval $(op signin)`
- Session token in `OP_SESSION` env var, expires after 30 min inactivity
- Less secure than app integration (session key in environment)

### 4. Connect Server

- Set `OP_CONNECT_HOST` and `OP_CONNECT_TOKEN`
- Private REST API for infrastructure secrets
- Works with `op run`, `op inject`, `op read`, `op item get`

### Multiple Accounts

- `op signin` — interactive account selection
- `--account <address-or-id>` — per-command account
- `OP_ACCOUNT` env var — default account

---

## CLI Environment Variables

| Variable                      | Description                                     |
| ----------------------------- | ----------------------------------------------- |
| `OP_SERVICE_ACCOUNT_TOKEN`    | Authenticate with a service account             |
| `OP_ACCOUNT`                  | Default account (sign-in address or ID)         |
| `OP_BIOMETRIC_UNLOCK_ENABLED` | Toggle app integration (`true`/`false`)         |
| `OP_CACHE`                    | Toggle caching (`true`/`false`, default `true`) |
| `OP_CONFIG_DIR`               | Custom config directory                         |
| `OP_CONNECT_HOST`             | Connect server URL                              |
| `OP_CONNECT_TOKEN`            | Connect server token                            |
| `OP_DEBUG`                    | Debug mode (`true`/`false`)                     |
| `OP_FORMAT`                   | Output format (`human-readable`/`json`)         |
| `OP_INCLUDE_ARCHIVE`          | Include archived items (`true`/`false`)         |
| `OP_ISO_TIMESTAMPS`           | ISO 8601 timestamps (`true`/`false`)            |
| `OP_RUN_NO_MASKING`           | Disable secret masking in `op run` output       |
| `OP_SESSION`                  | Manual sign-in session token                    |

---

## CLI Config Directories

Precedence (highest to lowest):

1. `--config` flag
2. `OP_CONFIG_DIR` env var
3. `~/.op`
4. `${XDG_CONFIG_HOME}/.op`
5. `~/.config/op`
6. `${XDG_CONFIG_HOME}/op`

---

## Key CLI Commands

### Secrets

```bash
# Read a single secret
op read "op://vault/item/field"

# Inject secrets into a template file
op inject -i config.tpl -o config.yml

# Run a command with secrets as env vars
op run --env-file=.env -- node app.js

# Run with environment switching
APP_ENV=prod op run --env-file=.env -- ./deploy.sh
```

`op run` scans env vars for `op://` references, resolves them, and passes to subprocess. Secrets in stdout/stderr are masked by default (`--no-masking` to disable).

### Items

```bash
# List items
op item list --vault=MyVault

# Get item details
op item get "item-name" --vault=MyVault
op item get "item-name" --fields label=username,label=password

# Create item
op item create --category=login --title="My Login" \
  --vault=MyVault \
  username=admin \
  password=secret123

# Create from JSON template
op item template get Login > template.json
# Edit template.json, then:
op item create --template=template.json --vault=MyVault

# Edit item
op item edit "item-name" password=newpassword

# Delete / archive
op item delete "item-name"
op item delete "item-name" --archive
```

### Vaults

```bash
op vault list
op vault create "Vault Name"
op vault get "Vault Name"
op vault delete "Vault Name"

# Permissions
op vault user grant --vault=MyVault --user=user@example.com --permissions=allow_viewing,allow_editing
op vault user revoke --vault=MyVault --user=user@example.com --permissions=allow_editing
op vault group grant --vault=MyVault --group=Developers --permissions=allow_viewing
```

### Account & Auth

```bash
op signin                     # interactive account selection
op whoami                     # current session info
op account list               # all configured accounts
op signout                    # end session
```

---

## Vault Permissions

### Teams / Families (broad)

- `allow_viewing` — view items, copy passwords, view history
- `allow_editing` — create, edit, archive, delete, import, export, copy, share, print
- `allow_managing` — manage vault access, delete vault

### Business (granular)

`view_items`, `view_and_copy_passwords`, `view_item_history`, `create_items`, `edit_items`, `archive_items`, `delete_items`, `import_items`, `export_items`, `copy_and_share_items`, `print_items`, `manage_vault`

Permissions are hierarchical — narrower ones require broader ones:

- `delete_items` requires `edit_items` + `view_and_copy_passwords` + `view_items`
- Revoking a broad permission also requires revoking all dependent narrow ones

---

## Item Fields

### Built-in fields

Each category has default fields (e.g., Login has `username`, `password`, `notesPlain`). Use `op item template get <category>` to see available fields.

### Custom field types

| CLI fieldType | JSON type    | Description                          |
| ------------- | ------------ | ------------------------------------ |
| `password`    | `CONCEALED`  | Concealed password                   |
| `text`        | `STRING`     | Text string                          |
| `email`       | `EMAIL`      | Email address                        |
| `url`         | `URL`        | Web address                          |
| `date`        | `DATE`       | Date (YYYY-MM-DD)                    |
| `monthYear`   | `MONTH_YEAR` | YYYYMM or YYYY/MM                    |
| `phone`       | `PHONE`      | Phone number                         |
| `otp`         | `OTP`        | One-time password (`otpauth://` URI) |
| `file`        | N/A          | File attachment (path)               |

---

## JavaScript SDK (`@1password/sdk`)

Package: `@1password/sdk` (npm)
GitHub: https://github.com/1Password/onepassword-sdk-js/
Auth: Service account tokens only (`OP_SERVICE_ACCOUNT_TOKEN`)

### Setup

```bash
npm install @1password/sdk
```

### Usage

```typescript
import { createClient } from '@1password/sdk'

const client = await createClient({
  auth: process.env.OP_SERVICE_ACCOUNT_TOKEN,
  integrationName: 'my-app',
  integrationVersion: 'v1.0.0',
})

// Resolve a single secret
const secret = await client.secrets.resolve('op://vault/item/field')

// List vaults
const vaults = await client.vaults.list()

// CRUD items
const item = await client.items.get(vaultId, itemId)
await client.items.create(vaultId, item)
await client.items.put(vaultId, item)
await client.items.delete(vaultId, itemId)
await client.items.archive(vaultId, itemId)
```

### Supported functionality

- Resolve secrets via `op://` references
- Full item CRUD (create, read, update, delete, archive, list, share)
- All field types including passwords, OTP, SSH keys, file attachments, passkeys
- Vault list and retrieve
- Password generation (PIN, random, memorable)

### Authentication

- Service accounts only (for now)
- User auth and Connect not yet supported in SDK
- Use `OP_SERVICE_ACCOUNT_TOKEN` env var or pass directly to `createClient({ auth })`

### Envi integration

Envi uses the 1Password JavaScript SDK in `src/providers/onepassword/provider.ts`.

- Uses service account token (`OP_SERVICE_ACCOUNT_TOKEN`) when set.
- Otherwise uses desktop app integration via `DesktopAuth(OP_ACCOUNT_NAME)`.
- Resolve secrets: `client.secrets.resolve(reference)`.
- List vaults: `client.vaults.list()`.

---

## Installation

### macOS

```bash
brew install --cask 1password-cli
```

### Linux (APT)

```bash
curl -sS https://downloads.1password.com/linux/keys/1password.asc | \
  sudo gpg --dearmor --output /usr/share/keyrings/1password-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/$(dpkg --print-architecture) stable main" | \
  sudo tee /etc/apt/sources.list.d/1password.list
sudo apt update && sudo apt install 1password-cli
```

### Docker

```dockerfile
FROM 1password/op:2
# or add to existing Dockerfile:
COPY --from=1password/op:2 /usr/local/bin/op /usr/local/bin/op
```

### Server (one-liner)

```bash
curl -sSfo op.zip https://cache.agilebits.com/dist/1P/op2/pkg/v2.30.3/op_linux_amd64_v2.30.3.zip && \
  unzip -od /usr/local/bin/ op.zip && rm op.zip
```

### Verify

```bash
op --version
```

---

## Security Notes

- App integration sessions are per-terminal, expire after 10 min inactivity (12h hard limit)
- Manual sign-in sessions expire after 30 min inactivity
- `op run` masks secrets in stdout/stderr by default
- Root/admin users may bypass security measures if the app is unlocked
- On macOS, CLI-to-app communication uses `NSXPCConnection` (XPC), verified by code signature
- On Linux, uses Unix socket with GID verification (`onepassword-cli` group)
- On Windows, uses named pipe with Authenticode signature verification

---

## Best Practices

1. **Use latest CLI** — `op update` to check for updates
2. **Principle of least privilege** — use service accounts scoped to specific vaults
3. **Use templates for sensitive items** — avoid passing secrets as CLI arguments (visible in process list/history)
4. **Prefer app integration** over manual sign-in for better security
5. **Use `op run`** to inject secrets as env vars — secrets never touch disk
6. **Use secret references** instead of plaintext — they're dynamic and reflect 1Password changes
