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

Envi applies the order to each config. One `sync` of several configs fills one cache, so every
config that uses the cache must end with the same cache encryption and directory. See
[Cache](./cache.md).

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
| `ENVI_DEBUG`                                      | `true` shows the debug logs on stderr, as `--debug` does.        |
| `ENVI_LOG_FILE`                                   | A file that receives every log as JSON lines.                    |
| `CI`                                              | Any value except empty, `false`, and `0` means CI.               |
| `ENVI_PROVIDER_ONEPASSWORD_ACCOUNT`               | The 1Password account.                                           |
| `ENVI_PROVIDER_ONEPASSWORD_SERVICE_ACCOUNT_TOKEN` | A 1Password service account token.                               |
| `OP_SERVICE_ACCOUNT_TOKEN`                        | A 1Password service account token, with a lower priority.        |

The CLI also reads the OpenTelemetry variables, such as `OTEL_EXPORTER_OTLP_ENDPOINT`, and
`TRACEPARENT`. See [Logs and traces](./cli/telemetry.md).
