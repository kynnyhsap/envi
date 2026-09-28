---
title: "Sources"
description: "Where a var gets its value, and the methods that decode, default, redact, and cache it."
---

# Sources

## Helpers

| Helper                    | Value                                                                           |
| ------------------------- | ------------------------------------------------------------------------------- |
| a string                  | A literal. It never enters the cache.                                           |
| `value(text)`             | A literal with the descriptor methods, such as `.schema()`.                     |
| `fromEnv(name)`           | A variable of the Envi process, such as a CI secret. It never enters the cache. |
| `op(...)`                 | A 1Password secret. See [1Password](../providers/1password.md).                 |
| `reference(id, ref)`      | A reference for the provider with the id `id`. A custom provider uses it.       |
| `derive(input, fn)`       | A pure synchronous function of other descriptors. Envi never caches it.         |
| `custom({ id, resolve })` | Effectful user code, such as a token exchange. Envi caches it.                  |

## Descriptor methods

Each method returns a new descriptor.

- `.schema(schema)` decodes the raw string with an Effect `Schema` that encodes to a string, such
  as `Schema.FiniteFromString`, `Schema.URLFromString`, or `BooleanFromString` from `envi`.
  Without a schema, the value is a `string`.
- `.optional()` gives `undefined` when the provider reports `NotFound`.
- `.default(raw)` gives a raw string when the provider reports `NotFound`. The default passes
  through the schema. Every other failure stays a failure.
- `.redact(false)` shows the value in `inspect` and in a redacted export. Secrets are redacted by
  default.
- `.cache(false)` resolves the value on every run. `.cache({ ttl, maxStale })` overrides the cache
  settings for one value.
