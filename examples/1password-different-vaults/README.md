# 1Password -- Different Vaults

Use `${ENV}` to switch vaults without changing the template.

## Vault Setup

Create these vaults in 1Password:

- `example-local`
- `example-staging`
- `example-prod`

Each vault should contain a secure note called `api-service` with these fields:

| Field | Description |
| --- | --- |
| `API_KEY` | API key for that environment |
| `DATABASE_URL` | Database connection string |
| `REDIS_URL` | Redis connection string |
| `STRIPE_SECRET` | Stripe secret key |

```bash
for env in local staging prod; do
  op vault create "example-${env}"

  op item create \
    --vault "example-${env}" \
    --category "Secure Note" \
    --title api-service \
    "API_KEY[concealed]=sk_${env}_abc123" \
    "DATABASE_URL[concealed]=postgres://user:pass@db-${env}:5432/mydb" \
    "REDIS_URL[concealed]=redis://redis-${env}:6379" \
    "STRIPE_SECRET[concealed]=sk_${env}_stripe_key"
done
```

## Usage

```bash
# Local development (default)
envi sync

# Staging
envi sync -e staging

# Production
envi sync -e prod

# Resolve one production secret directly
envi resolve -e prod op://example-${ENV}/api-service/API_KEY
```

`op://example-${ENV}/api-service/API_KEY` becomes `op://example-staging/api-service/API_KEY` when you run with `-e staging`.
