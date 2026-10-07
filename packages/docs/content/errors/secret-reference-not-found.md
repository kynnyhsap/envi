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

See [envi find](../cli/find.md).
