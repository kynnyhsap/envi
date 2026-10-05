---
title: "SettingsError"
description: "A setting holds a value that Envi cannot read, or the configs or clients of a sync disagree."
---

# SettingsError

A setting holds a value that Envi cannot read: an `ENVI_*` environment variable, a key of the
config such as `cache.ttl`, the `.cache()` of one descriptor such as `vars.TOKEN.cache.ttl`, or
an option of a client or a layer such as `option cache.ttl`. An input of `derive()` or `custom()`
adds its name to the path, such as `vars.TOKEN.secret.cache.ttl`.

Envi reports a variable only when it uses it. A flag or an option that overrides the variable,
such as `--config-search` over `ENVI_CONFIG_SEARCH`, avoids the error.

One `sync` of several configs fills one cache, so every config that uses the cache must select the
same `cache.encryption` and `cache.directory`. When two configs differ, the error names the
setting, both config files, and the value that each one selects, and `sync` writes nothing. Give
the configs the same value, or select one directory for all with `--cache-dir` or
`ENVI_CACHE_DIR`.

`syncAll(clients)` runs one sync with one set of overrides, so every client must have the same
overrides of `createEnvi`. When a client differs from the first client, the error names the
option, such as `option strict`, and `syncAll` resolves nothing. Give the clients the same
overrides, or sync them apart.

Next action: Fix the value of the setting that the error names, or remove it.
