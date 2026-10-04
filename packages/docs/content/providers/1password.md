---
title: "1Password"
description: "The 1Password provider: op() references, authentication, timeouts, and errors."
---

# 1Password

`@kynnyhsap/envi-1password` is the 1Password provider. It resolves `op()` references through the official `@1password/sdk`, in one batch for each run. It does not need the `op` CLI. Install it next to Envi, as [Getting started](../getting-started.md) shows.

## Usage

```ts
import { defineConfig } from "@kynnyhsap/envi";
import { onePasswordProvider } from "@kynnyhsap/envi-1password";

export default defineConfig({
  stages: ["development", "production"],
  providers: [onePasswordProvider({ account: "my-team" })],
  vars: ({ stage, op }) => ({
    DATABASE_URL: op(`op://app-${stage}/postgres/url`),
    STRIPE_KEY: op("payments", "stripe", "secret-key"),
  }),
});
```

`vars` receives `op` from the provider, so the config needs no import of `op`. Code outside
`vars` imports `op` from `@kynnyhsap/envi-1password`.

## References

`op()` takes one of three forms. All three give the same cache entry.

```ts
op("op://app/postgres/url"); // op://vault/item/field or op://vault/item/section/field
op("app", "postgres", "url"); // vault, item, field
op({ account: "partner-team", vault: "app", item: "postgres", section: "prod", field: "url" });
```

- `account` in the object form selects another account for one reference.
- A name with `/` or `?` needs its ID, because the reference syntax cannot escape them.
- Envi supports no query attribute, such as `?attribute=otp`.
- A missing vault, item, or field gives `NotFound`, so `.optional()` and `.default()` apply.
- An item that the credential cannot read gives `AccessDenied`. A malformed reference gives
  `Invalid`.

## Authentication

| Setting               | Variable                                                                           |
| --------------------- | ---------------------------------------------------------------------------------- |
| `serviceAccountToken` | `ENVI_PROVIDER_ONEPASSWORD_SERVICE_ACCOUNT_TOKEN`, then `OP_SERVICE_ACCOUNT_TOKEN` |
| `account`             | `ENVI_PROVIDER_ONEPASSWORD_ACCOUNT`                                                |

A variable wins over a setting. An empty variable counts as absent.

- **Service account.** With a token, the provider uses the service account and never asks for an
  approval. Use a token in CI and for a coding agent.
- **Desktop app.** Without a token, the provider asks the 1Password app for an approval. `account`
  is the account name from the sidebar of the app, or the account UUID. Enable the SDK
  integration in the app under Settings > Developer. The provider uses the app only when the run
  is interactive, so a CI run without a token fails at once with `AuthenticationFailed`.

`envi run` removes the token variables and every `ENVI_PROVIDER_*` variable from the child.

## Behavior

- The provider imports `@1password/sdk` and creates a client only on a cache miss, because a
  client takes 2 to 5 seconds. A run from the cache never loads the SDK.
- The provider creates one client for each token and each account, and resolves the references
  of one account in one `resolveAll` call. Two concurrent operations in one process share one
  client. A new token gets a new client. A failed connection is not kept.
- The provider checks the form of each `resolveAll` answer. An answer of another form gives
  `InvalidResponse`.
- A call with a token times out after 30 seconds. A desktop call waits 90 seconds for the
  approval.
- A rate limit, a network failure, and a timeout give `Unavailable`, so an expired cache entry can
  serve the run. An expired session and a rejected token give `AuthenticationFailed`.
- The 1Password app rejects parallel desktop connections from several processes. The resolve lock
  of the Envi cache serializes them in most cases. See [Known limits](../known-limits.md). A
  service account token has no such limit.

[Errors](../errors/index.md) explains each error and its next action.
