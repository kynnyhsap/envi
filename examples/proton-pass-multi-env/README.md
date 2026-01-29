# Proton Pass — Multi-Environment

Use `${ENV}` substitution to pull secrets from different vaults per environment.

## Prerequisites

1. Install [pass-cli](https://proton.me/pass/download)
2. Log in: `pass-cli login`

## Vault Setup

Create these vaults in Proton Pass, each with an item called **api-service**:

- **example-local**
- **example-staging**
- **example-prod**

Each item should have these fields:

| Field          | Description                |
| -------------- | -------------------------- |
| `API_KEY`      | API key for the env        |
| `DATABASE_URL` | Database connection string |
| `REDIS_URL`    | Redis connection string    |

### Setup via CLI

```bash
# Create vaults
pass-cli vault create --name "example-local"
pass-cli vault create --name "example-staging"
pass-cli vault create --name "example-prod"

# Create items in each vault
for env in local staging prod; do
  pass-cli item create login \
    --vault-name "example-${env}" \
    --title "api-service" \
    --password "placeholder"
done
```

> **Note:** Proton Pass custom fields are easiest to add via the desktop/web app. Create the items with the CLI, then add the custom fields (`API_KEY`, `DATABASE_URL`, `REDIS_URL`) through the app. Verify with:
> ```bash
> pass-cli item view "pass://example-local/api-service/API_KEY"
> ```

## Usage

```bash
# Local development (default)
envi sync --provider proton-pass

# Staging
envi sync --provider proton-pass -e staging

# Production
envi sync --provider proton-pass -e prod
```

## How ${ENV} Works

```
pass://example-${ENV}/api-service/API_KEY
                  ↓ --env staging
pass://example-staging/api-service/API_KEY
```
