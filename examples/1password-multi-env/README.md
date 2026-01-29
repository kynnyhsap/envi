# 1Password — Multi-Environment

Use `${ENV}` substitution to pull secrets from different vaults per environment.

## Vault Setup

Create these vaults in 1Password:

- **example-local**
- **example-staging**
- **example-prod**

Each vault should have an item called **api-service** with these fields:

| Field           | Description                        |
| --------------- | ---------------------------------- |
| `API_KEY`       | API key for the environment        |
| `DATABASE_URL`  | Database connection string         |
| `REDIS_URL`     | Redis connection string            |
| `STRIPE_SECRET` | Stripe secret key                  |

## Usage

```bash
# Local development (default --env is "local")
envi sync

# Staging
envi sync -e staging

# Production
envi sync -e prod

# Run with staging secrets
envi run -e staging -- node server.js
```

## How ${ENV} Works

The `${ENV}` placeholder in `.env.example` is replaced with the value of `--env` before resolving secrets:

```
op://example-${ENV}/api-service/API_KEY
                ↓ --env staging
op://example-staging/api-service/API_KEY
```
