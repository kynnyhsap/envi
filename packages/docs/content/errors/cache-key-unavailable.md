---
title: "CacheError KeyUnavailable"
description: "Envi has no encryption key for the cache."
---

# CacheError KeyUnavailable

Envi has no encryption key for the cache: `ENVI_CACHE_KEY` is not set, and the OS keychain gives no key. Without `--cache` or `ENVI_CACHE_ENABLED`, Envi warns once and runs without a cache.

Next action: Set ENVI_CACHE_KEY, or allow Envi to use the OS keychain (on Linux, install `secret-tool`), or turn the cache off with `--no-cache`.
