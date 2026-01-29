# Proton Pass — Basic

The simplest setup with Proton Pass: a single `.env.example` with `pass://` references.

## Prerequisites

1. Install [pass-cli](https://proton.me/pass/download)
2. Log in: `pass-cli login`

## Vault Setup

Create a vault called **example** in Proton Pass with an item called **api-service** containing these fields:

| Field          | Example Value                              |
| -------------- | ------------------------------------------ |
| `API_KEY`      | `sk_live_abc123`                           |
| `DATABASE_URL` | `postgres://user:pass@localhost:5432/mydb` |
| `JWT_SECRET`   | `super-secret-jwt-key`                     |

### Setup via CLI

```bash
# Create the vault
pass-cli vault create --name "example"

# Create the item with fields
# Note: pass-cli creates login items with standard fields (username, password, etc.)
# For custom fields, create via the Proton Pass app or use a template:
pass-cli item create login \
  --vault-name "example" \
  --title "api-service" \
  --password "sk_live_abc123"

# For multiple custom fields, use a template:
echo '{
  "title": "api-service",
  "username": "",
  "password": "sk_live_abc123",
  "urls": [],
  "note": "API_KEY=sk_live_abc123\nDATABASE_URL=postgres://user:pass@localhost:5432/mydb\nJWT_SECRET=super-secret-jwt-key"
}' > /tmp/api-service.json

pass-cli item create login \
  --vault-name "example" \
  --from-template /tmp/api-service.json
```

> **Tip:** For items with many custom fields, it's easier to create them in the Proton Pass desktop or web app, then verify with `pass-cli item view "pass://example/api-service/API_KEY"`.

## Usage

```bash
# Sync secrets to .env
envi sync --provider proton-pass

# Preview without writing
envi sync --provider proton-pass -d

# Run a command with secrets injected
envi run --provider proton-pass -- node server.js
```

## What Happens

1. Envi reads `.env.example`
2. Plain values (`NODE_ENV`, `PORT`) are copied as-is
3. `pass://` references are resolved via Proton Pass CLI
4. Result is written to `.env`
