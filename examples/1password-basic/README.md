# 1Password — Basic

One app, one vault, a few `op://` references.

## Vault Setup

Create a vault called `envi-example` and a secure note called `api-service` with these fields:

| Field          | Example Value                              |
| -------------- | ------------------------------------------ |
| `API_KEY`      | `sk_live_abc123`                           |
| `DATABASE_URL` | `postgres://user:pass@localhost:5432/mydb` |
| `JWT_SECRET`   | `super-secret-jwt-key`                     |

```bash
op vault create envi-example

op item create \
  --vault envi-example \
  --category "Secure Note" \
  --title api-service \
  'API_KEY[concealed]=sk_live_abc123' \
  'DATABASE_URL[concealed]=postgres://user:pass@localhost:5432/mydb' \
  'JWT_SECRET[concealed]=super-secret-jwt-key'
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

`envi sync` reads `.env.example`, resolves the `op://` values from 1Password, and writes `.env`.
