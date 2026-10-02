---
title: "Cache"
description: "Where Envi stores resolved values, how long they stay fresh, and how it encrypts them."
---

# Cache

The cache holds one entry for each secret, in `~/.cache/envi` by default. Parallel worktrees share
the entries. `--cache-dir`, the `cache` option of a client, `ENVI_CACHE_DIR`, or `cache.directory`
of the config selects another directory, in this order.

- An entry expires after `ttl`, 24 hours by default. When the refresh of an expired entry fails
  because the provider is unavailable, Envi uses the expired value up to `maxStale`, 7 days by
  default, and logs a warning. `NotFound`, `AccessDenied`, and `Invalid` never allow the expired
  value. `--strict` and CI turn the fallback off.
- Envi encrypts each entry with AES-256-GCM. The key comes from `ENVI_CACHE_KEY`, or from the
  keychain: the macOS Keychain, or the Secret Service on Linux through `secret-tool`, such as GNOME
  Keyring. Envi creates the key on the first use.
- Without a key, Envi logs one warning and runs without a cache. With `--cache` or
  `ENVI_CACHE_ENABLED=true`, a missing key fails with
  [`KeyUnavailable`](errors/cache-key-unavailable.md).
- Envi never falls back from encryption to plaintext. `encryption: "none"` writes plaintext files
  with the mode `0600`, as an explicit opt-in.
- One `sync` of several configs fills one cache. Every config that uses the cache must select the
  same encryption and the same directory after the precedence order, or `sync` fails with a
  [`SettingsError`](errors/settings.md) before it resolves or writes anything. A config with the
  cache off does not count. `--cache-dir`, `ENVI_CACHE_DIR`, or the `cache` option of the client
  selects one directory for every config.
- A lock serializes the resolution of several processes on an empty cache, so a provider gets one
  call. Envi recovers the lock of a crashed process.
- The cache serves the trust level of a `.env` file. Any process of the OS user can use it, a coding
  agent too. The encryption protects the files against file reads, searches, and backups.
- The cache is off in CI by default. `cache path`, `cache list`, and `cache clear` always use the
  cache directory, also in CI.
