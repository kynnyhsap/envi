# 1Password -- Environments

Use `${PROFILE}` to switch item names inside one shared vault.

## Vault Setup

Create a vault called `envi-example` with these secure notes:

- `api-service-default`
- `api-service-local`
- `api-service-staging`
- `api-service-prod`

Each item should contain these fields:

| Field           | Description                  |
| --------------- | ---------------------------- |
| `API_KEY`       | API key for that environment |
| `DATABASE_URL`  | Database connection string   |
| `REDIS_URL`     | Redis connection string      |
| `STRIPE_SECRET` | Stripe secret key            |

```bash
op vault create envi-example

for env in default local staging prod; do
  op item create \
    --vault envi-example \
    --category "Secure Note" \
    --title "api-service-${env}" \
    "API_KEY[concealed]=sk_${env}_abc123" \
    "DATABASE_URL[concealed]=postgres://user:pass@db-${env}:5432/mydb" \
    "REDIS_URL[concealed]=redis://redis-${env}:6379" \
    "STRIPE_SECRET[concealed]=sk_${env}_stripe_key"
done
```

## Usage

```bash
# Default profile item
envi sync --var PROFILE=default

# Local development
envi sync --var PROFILE=local

# Staging
envi sync --var PROFILE=staging

# Production
envi sync --var PROFILE=prod

# Resolve one production secret directly
envi resolve --var PROFILE=prod op://envi-example/api-service-${PROFILE}/API_KEY
```

`op://envi-example/api-service-${PROFILE}/API_KEY` becomes `op://envi-example/api-service-staging/API_KEY` when you run with `--var PROFILE=staging`.
