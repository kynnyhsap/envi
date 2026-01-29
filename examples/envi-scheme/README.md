# Universal envi:// Scheme

The `envi://` scheme is provider-agnostic. It gets converted to the native scheme of whichever provider you use. This means the same `.env.example` works with any provider.

## How It Works

```
envi://example/api-service/API_KEY
        ↓ --provider 1password
op://example/api-service/API_KEY

envi://example/api-service/API_KEY
        ↓ --provider proton-pass
pass://example/api-service/API_KEY
```

## Vault Setup

Create a vault called **example** in your password manager with an item called **api-service** containing:

| Field          | Example Value                                      |
| -------------- | -------------------------------------------------- |
| `API_KEY`      | `sk_live_abc123`                                   |
| `DATABASE_URL` | `postgres://user:pass@localhost:5432/mydb`         |
| `JWT_SECRET`   | `super-secret-jwt-key`                             |

## Usage

```bash
# With 1Password (default)
envi sync

# With Proton Pass
envi sync --provider proton-pass
```

## When to Use envi://

Use `envi://` when:

- Your team uses different password managers
- You want to switch providers without changing templates
- You're building an open-source project and don't want to lock into a provider

Use native schemes (`op://`, `pass://`) when:

- Your team is standardized on one provider
- You want the templates to be explicit about which provider to use
