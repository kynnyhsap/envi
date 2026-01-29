# 1Password — Basic

The simplest setup: a single `.env.example` with `op://` references pointing to one vault.

## Vault Setup

Create a vault called **example** in 1Password with an item called **api-service** containing these fields:

| Field          | Example Value                              |
| -------------- | ------------------------------------------ |
| `API_KEY`      | `sk_live_abc123`                           |
| `DATABASE_URL` | `postgres://user:pass@localhost:5432/mydb` |
| `JWT_SECRET`   | `super-secret-jwt-key`                     |

### Setup via CLI

```bash
# Create the vault
op vault create example

# Create the item with fields
op item create \
  --vault example \
  --category login \
  --title "api-service" \
  'API_KEY[password]=sk_live_abc123' \
  'DATABASE_URL[password]=postgres://user:pass@localhost:5432/mydb' \
  'JWT_SECRET[password]=super-secret-jwt-key'
```

## Usage

```bash
# Sync secrets to .env
envi sync

# Preview without writing
envi sync -d

# Run a command with secrets injected
envi run -- node server.js
```

## What Happens

1. Envi reads `.env.example`
2. Plain values (`NODE_ENV`, `PORT`) are copied as-is
3. `op://` references are resolved via 1Password
4. Result is written to `.env`
