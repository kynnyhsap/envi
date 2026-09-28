---
title: "derive and custom"
description: "Compute a var from other values with pure code, or with effectful code that Envi caches."
---

# derive and custom

Both take their inputs as descriptors. Envi resolves every reference in one batch for each
provider, and then evaluates each value from the inside to the outside. An input does not have to
be a var: `envi run` injects only the vars. Both return a raw string or `undefined`, and
`undefined` counts as `NotFound`.

```ts
vars: ({ op, derive, custom }) => ({
  // A pure function. Envi calls it on every run.
  REPLICA_URL: derive(
    { user: op("app", "replica", "user"), password: op("app", "replica", "password") },
    ({ user, password }) => `postgres://${user}:${password}@replica/app`,
  ),
  // Effectful code. `resolve` returns a string, `undefined`, a `Promise`, or an `Effect`.
  API_TOKEN: custom({
    id: "api-token",
    from: { clientSecret: op("app", "oauth", "client-secret") },
    resolve: ({ clientSecret }) => exchangeToken(clientSecret),
  }).cache({ ttl: "50 minutes" }),
}),
```

- `id` names a `custom()` value in the cache and in errors. `scope` names everything outside the
  inputs that selects the value, such as a host.
- Envi keeps one entry for each `id`, stage, and `scope`. The entry holds a digest of the code of
  `resolve` and of the input values. A changed input or a changed `resolve` computes a new value.
- A throw shows only the class name and the location, never the message, because a message can
  hold a secret. A `CustomFailure({ message, transient })` shows its message. `transient: true`
  allows an expired entry of the same inputs.
