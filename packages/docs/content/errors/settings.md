---
title: "SettingsError"
description: "A setting holds a value that Envi cannot read."
---

# SettingsError

A setting holds a value that Envi cannot read: an `ENVI_*` environment variable, a key of the
config such as `cache.ttl`, the `.cache()` of one descriptor such as `vars.TOKEN.cache.ttl`, or
an option of a client or a layer such as `option cache.ttl`. An input of `derive()` or `custom()`
adds its name to the path, such as `vars.TOKEN.secret.cache.ttl`.

Next action: Fix the value of the setting that the error names, or remove it.
