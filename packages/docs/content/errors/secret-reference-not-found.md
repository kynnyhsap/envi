---
title: "SecretReferenceError NotFound"
description: "The provider has no secret at the reference, or the credential cannot see it."
---

# SecretReferenceError NotFound

The provider has no secret at the reference, or the credential cannot see it.

Next action: Check that the reference names an existing secret, and that the credential can see it. Run `envi find <name>` to list the references of a close name. If the var may be missing, add `.optional()` or `.default(value)`.

A typo in the vault, the item, or the field gives this error. `envi find` takes the reference
itself and lists the closest references first, without a value:

```sh
envi find op://app/postgress/url
```

When the provider can search, the error names up to three close references, such as
`Close references: op://app/postgres/url`. The summary holds them, and the `candidates` field of
the SDK error holds the same `describe()` texts. Envi searches after the resolution, with one
search call for each provider, for every missing reference of a required var. The search is best
effort. If it fails or takes more than 10 seconds, the error names no close reference and stays
`NotFound`. A missing optional var, or a var with a default, starts no search.

See [envi find](../cli/find.md).
