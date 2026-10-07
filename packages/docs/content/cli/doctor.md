---
title: "envi doctor"
description: "Show the facts of a setup for a bug report, without a config import, a secret, or a path."
---

# envi doctor

`envi doctor` shows the facts of a setup that a public issue can hold. It needs no config and no
network. It never imports a config, never calls a provider, never runs a hook of the repo, and
never reads the keychain, so it never shows a prompt.

```sh
envi doctor
envi doctor --json
```

| Field            | Holds                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `version`        | The version of Envi.                                                                       |
| `runtime`        | `node` or `bun`, and its version.                                                          |
| `platform`       | The OS and the CPU architecture, such as `darwin arm64`.                                   |
| `ci`             | `true` when `CI` is set, except to empty, `false`, or `0`. See [Settings](../settings.md). |
| `configs`        | The number of config files of a search `up` from here and of the whole `repo`.             |
| `cacheDirectory` | `true` when a cache directory is selected: `ENVI_CACHE_DIR`, or the default in `HOME`.     |
| `keychain`       | The keychain of the platform, and whether `PATH` holds its command as an executable.       |
| `variables`      | The names of the `ENVI_*` variables that are set.                                          |

`envi doctor` shows no path, no reference, and no value of a variable, because a value such as
`ENVI_CACHE_KEY` or `ENVI_CACHE_DIR` can be a secret or a private path. A config can change the
cache settings, and `envi doctor` does not import it. Run `envi check` to resolve the vars of a
config. A bad value of another cache setting, such as `ENVI_CACHE_ENABLED`, does not stop the
report. `variables` names the variable, and `envi check` shows its error.

`keychain` shows only that the command exists. An empty entry of `PATH` names the working folder,
as for the shell. `envi check` reads the key, and the keychain can
still be locked or refuse access. See [Cache](../cache.md).
