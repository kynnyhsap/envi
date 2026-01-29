# 1Password — Multi-Environment

Use `${ENV}` substitution to pull secrets from different vaults per environment.

## Vault Setup

Create these vaults in 1Password, each with an item called **api-service**:

- **example-local**
- **example-staging**
- **example-prod**

Each item should have these fields:

| Field           | Description                |
| --------------- | -------------------------- |
| `API_KEY`       | API key for the env        |
| `DATABASE_URL`  | Database connection string |
| `REDIS_URL`     | Redis connection string    |
| `STRIPE_SECRET` | Stripe secret key          |

### Setup via CLI

```bash
# Create vaults
op vault create example-local
op vault create example-staging
op vault create example-prod

# Create items in each vault
for env in local staging prod; do
  op item create \
    --vault "example-${env}" \
    --category login \
    --title "api-service" \
    "API_KEY[password]=sk_${env}_abc123" \
    "DATABASE_URL[password]=postgres://user:pass@db-${env}:5432/mydb" \
    "REDIS_URL[password]=redis://redis-${env}:6379" \
    "STRIPE_SECRET[password]=sk_${env}_stripe_key"
done
```

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
