---
title: "Settings"
description: "The one precedence order of every setting, and every environment variable."
---

# Settings

Every setting follows one order: a CLI flag or a call option, a client option, an environment
variable, a config key, a default.

Envi reads a setting only when no setting above it decides. A flag or an option overrides an
environment variable that holds a value Envi cannot read, and Envi reports a
[`SettingsError`](errors/settings.md) for a variable only when it uses the variable. For example,
`envi check --config-search up` ignores `ENVI_CONFIG_SEARCH`, and `strict: false` ignores
`ENVI_STRICT`.

| Variable                                          | Setting                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `ENVI_STAGE`                                      | The stage.                                                       |
| `ENVI_CONFIG`                                     | A comma-separated list of config files.                          |
| `ENVI_CONFIG_SEARCH`                              | `up`, `down`, or `repo`.                                         |
| `ENVI_STRICT`                                     | `true` never uses an expired cache entry.                        |
| `ENVI_INTERACTIVE`                                | `true` or `false`. Default: `false` in CI, `true` elsewhere.     |
| `ENVI_CACHE_ENABLED`                              | `true` or `false`. Default: `false` in CI, `true` elsewhere.     |
| `ENVI_CACHE_DIR`                                  | The cache directory. Default: `~/.cache/envi`.                   |
| `ENVI_CACHE_KEY`                                  | The key of the encrypted cache, for a system without a keychain. |
| `CI`                                              | Any value except empty, `false`, and `0` means CI.               |
| `ENVI_PROVIDER_ONEPASSWORD_ACCOUNT`               | The 1Password account.                                           |
| `ENVI_PROVIDER_ONEPASSWORD_SERVICE_ACCOUNT_TOKEN` | A 1Password service account token.                               |
| `OP_SERVICE_ACCOUNT_TOKEN`                        | A 1Password service account token, with a lower priority.        |
