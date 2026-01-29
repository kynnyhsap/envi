# Proton Pass — Multi-Environment

Use `${ENV}` substitution to pull secrets from different vaults per environment.

## Prerequisites

1. Install [pass-cli](https://proton.me/pass/download)
2. Log in: `pass-cli login`

## Vault Setup

Create these vaults in Proton Pass:

- **example-local**
- **example-staging**
- **example-prod**

Each vault should have an item called **api-service** with these fields:

| Field          | Description                        |
| -------------- | ---------------------------------- |
| `API_KEY`      | API key for the environment        |
| `DATABASE_URL` | Database connection string         |
| `REDIS_URL`    | Redis connection string            |

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
