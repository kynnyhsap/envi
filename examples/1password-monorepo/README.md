# 1Password — Monorepo

Multiple packages, each with its own `.env.example`. Envi auto-discovers them from the repo root.

## Structure

```
1password-monorepo/
├── api/
│   └── .env.example      # API service secrets
├── web/
│   └── .env.example      # Web app secrets
└── worker/
    └── .env.example      # Worker secrets
```

## Vault Setup

Create a vault called `envi-example` with these items:

**api-service**
| Field | Description |
| -------------- | ------------------- |
| `API_KEY` | API key |
| `DATABASE_URL` | Database connection |

**web-app**
| Field | Description |
| --------------------- | ------------------- |
| `SESSION_SECRET` | Session signing key |
| `OAUTH_CLIENT_ID` | OAuth client ID |
| `OAUTH_CLIENT_SECRET` | OAuth client secret |

**worker**
| Field | Description |
| ---------- | ---------------- |
| `REDIS_URL`| Redis connection |

```bash
op vault create envi-example

op item create \
  --vault envi-example \
  --category "Secure Note" \
  --title api-service \
  'API_KEY[concealed]=sk_live_abc123' \
  'DATABASE_URL[concealed]=postgres://user:pass@localhost:5432/mydb'

op item create \
  --vault envi-example \
  --category "Secure Note" \
  --title web-app \
  'SESSION_SECRET[concealed]=session-signing-key-xyz' \
  'OAUTH_CLIENT_ID[text]=oauth-client-id-123' \
  'OAUTH_CLIENT_SECRET[concealed]=oauth-client-secret-456'

op item create \
  --vault envi-example \
  --category "Secure Note" \
  --title worker \
  'REDIS_URL[concealed]=redis://localhost:6379'
```

## Usage

```bash
# Sync all services at once (auto-discovers .env.example files)
envi sync

# Sync only the API service
envi sync --only api

# Preview all changes
envi sync -d
```

Run `envi sync` from the monorepo root and Envi will create one `.env` beside each discovered `.env.example`.
