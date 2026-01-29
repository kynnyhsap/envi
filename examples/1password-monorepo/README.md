# 1Password — Monorepo

Multiple services in a monorepo, each with their own `.env.example`. Envi auto-discovers all of them.

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

Create a vault called **example** with these items:

**api-service**
| Field          | Description         |
| -------------- | ------------------- |
| `API_KEY`      | API key             |
| `DATABASE_URL` | Database connection |

**web-app**
| Field                 | Description         |
| --------------------- | ------------------- |
| `SESSION_SECRET`      | Session signing key |
| `OAUTH_CLIENT_ID`     | OAuth client ID     |
| `OAUTH_CLIENT_SECRET` | OAuth client secret |

**worker**
| Field      | Description      |
| ---------- | ---------------- |
| `REDIS_URL`| Redis connection |

### Setup via CLI

```bash
# Create the vault
op vault create example

# API service item
op item create \
  --vault example \
  --category login \
  --title "api-service" \
  'API_KEY[password]=sk_live_abc123' \
  'DATABASE_URL[password]=postgres://user:pass@localhost:5432/mydb'

# Web app item
op item create \
  --vault example \
  --category login \
  --title "web-app" \
  'SESSION_SECRET[password]=session-signing-key-xyz' \
  'OAUTH_CLIENT_ID[password]=oauth-client-id-123' \
  'OAUTH_CLIENT_SECRET[password]=oauth-client-secret-456'

# Worker item
op item create \
  --vault example \
  --category login \
  --title "worker" \
  'REDIS_URL[password]=redis://localhost:6379'
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

## How Auto-Discovery Works

When you run `envi sync` from the monorepo root, Envi scans for all `.env.example` files and creates a `.env` next to each one. No configuration needed.
