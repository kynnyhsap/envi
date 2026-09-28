---
title: "SecretReferenceError NotFound"
description: "The provider has no secret at the reference, or the credential cannot see it."
---

# SecretReferenceError NotFound

The provider has no secret at the reference, or the credential cannot see it.

Next action: Check that the reference names an existing secret, and that the credential can see it. If the var may be missing, add `.optional()` or `.default(value)`.
