---
title: "CLI"
description: "Every command and flag of the envi CLI, and where the logs go."
---

# CLI

| Command             | Does                                                                |
| ------------------- | ------------------------------------------------------------------- |
| `envi run -- <cmd>` | Runs a command with the resolved vars.                              |
| `envi sync`         | Resolves every var of every config in the repo and fills the cache. |
| `envi check`        | Resolves and validates every var. Shows no value.                   |
| `envi inspect`      | Shows where each var comes from. Hides secrets by default.          |
| `envi export`       | Prints the vars as dotenv or JSON, or writes them to a file.        |
| `envi find <query>` | Lists the references whose names match. See [envi find](./find.md). |
| `envi cache path`   | Prints the cache directory.                                         |
| `envi cache list`   | Lists the cache entries. Shows no value.                            |
| `envi cache clear`  | Removes every cache entry.                                          |
| `envi docs`         | Reads the docs of this Envi offline. See [envi docs](./docs.md).    |
| `envi doctor`       | Shows the setup for a bug report. See [envi doctor](./doctor.md).   |

A flag follows its command: `envi check --stage production`.

`envi sync` fills one cache for every config that it finds. A config with `cache: false` does not
turn the cache off for the others. Each config that uses the cache must select the same encryption
and directory, or `sync` fails with a [`SettingsError`](../errors/settings.md) and writes nothing.
`--cache-dir` selects one directory for every config. `envi sync` says that the cache is off, and
the `cache` field of its `--json` report is `false`, only when no config uses the cache. See
[Cache](../cache.md).

| Flag                                | Commands                                      | Does                                                                                    |
| ----------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `--config <file>`                   | run, sync, check, inspect, export, find       | Selects a config file. Repeat it for several files.                                     |
| `--config-search <direction>`       | run, sync, check, inspect, export, find       | `up`, `down`, or `repo`. See below.                                                     |
| `--stage <name>`                    | run, sync, check, inspect, export             | Selects the stage.                                                                      |
| `--refresh`                         | run, sync, check, inspect, export             | Ignores fresh cache entries.                                                            |
| `--strict`                          | run, sync, check, inspect, export             | Never uses an expired cache entry.                                                      |
| `--interactive`, `--no-interactive` | run, sync, check, inspect, export, find       | Allows or forbids a prompt, such as a desktop app approval.                             |
| `--cache`, `--no-cache`             | run, sync, check, inspect, export             | Turns the cache on or off.                                                              |
| `--cache-dir <dir>`                 | run, sync, check, inspect, export, cache      | Selects the cache directory.                                                            |
| `--json`                            | every command except run and bare `envi docs` | Prints the report, or the error, as JSON on stdout.                                     |
| `--redact`, `--no-redact`           | inspect, export                               | Hides or shows the secret values. `inspect` hides them by default, `export` shows them. |
| `--format dotenv\|json`             | export                                        | Selects the output format.                                                              |
| `--output <file>`                   | export                                        | Writes a file with the mode `0600`.                                                     |
| `--debug`                           | every command                                 | Shows debug logs, with the duration of each step.                                       |
| `--log-format pretty\|json`         | every command                                 | Selects the format of the logs on stderr.                                               |

A boolean flag also takes a value, such as `--json=true` or `--debug=false`.

`envi export --output <file>` writes a new file with the mode `0600` next to the target, and then
renames it over the target. The values never sit in a file with a wider mode, and a failed write
keeps the old file. The folder of the file must be writable. For a symlink, Envi replaces the file
that the link points to, and keeps the link.

All logs go to stderr, so stdout stays clean for `export` and `--json`. `--json` changes only
stdout, and `--log-format` alone selects the format of the logs. A log never holds a secret value.
