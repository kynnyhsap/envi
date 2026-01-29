# Proton Pass — Basic

The simplest setup with Proton Pass: a single `.env.example` with `pass://` references.

## Prerequisites

1. Install [pass-cli](https://proton.me/pass/download)
2. Log in: `pass-cli login`

## Vault Setup

Create a vault called **example** in Proton Pass with an item called **api-service** containing these fields:

| Field          | Example Value                                      |
| -------------- | -------------------------------------------------- |
| `API_KEY`      | `sk_live_abc123`                                   |
| `DATABASE_URL` | `postgres://user:pass@localhost:5432/mydb`         |
| `JWT_SECRET`   | `super-secret-jwt-key`                             |

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
