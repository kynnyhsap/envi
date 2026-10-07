---
title: "CI"
description: "Run Envi in CI: a service account token, no cache by default, and an optional shared cache."
---

# CI

- Set a service account token, such as `OP_SERVICE_ACCOUNT_TOKEN`. CI runs are not interactive,
  so the 1Password provider fails at once without a token.
- The cache is off, and every run is strict. `envi sync` says that the cache is off.
- To keep a cache between jobs, set `ENVI_CACHE_KEY` from a CI secret and `--cache` or
  `ENVI_CACHE_ENABLED=true`, and cache the directory of `ENVI_CACHE_DIR`.
- In the SDK, a `cache` object option of a client or a layer turns the cache on in CI too. Use
  `cache: false` in the options to keep it off.
