---
title: "CacheError KeyUnavailable"
description: "Envi has no encryption key for the cache."
---

# CacheError KeyUnavailable

Envi has no encryption key for the cache: `ENVI_CACHE_KEY` is not set, and the OS keychain gives no key. Envi warns once and runs without a cache, unless `--cache` or `ENVI_CACHE_ENABLED=true` asks for the cache. Envi reads `ENVI_CACHE_ENABLED` only when no `cache` option of a client or a layer decides, so a `cache` object option only warns.

Next action: Set ENVI_CACHE_KEY, or allow Envi to use the OS keychain (on Linux, install `secret-tool`), or turn the cache off with `--no-cache`.
