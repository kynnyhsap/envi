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
| `envi cache path`   | Prints the cache directory.                                         |
| `envi cache list`   | Lists the cache entries. Shows no value.                            |
| `envi cache clear`  | Removes every cache entry.                                          |

A flag follows its command: `envi check --stage production`.

| Flag                                | Commands                          | Does                                                        |
| ----------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| `--config <file>`                   | run, sync, check, inspect, export | Selects a config file. Repeat it for several files.         |
| `--config-search <direction>`       | run, sync, check, inspect, export | `up`, `down`, or `repo`. See below.                         |
| `--stage <name>`                    | run, sync, check, inspect, export | Selects the stage.                                          |
| `--refresh`                         | run, sync, check, inspect, export | Ignores fresh cache entries.                                |
| `--strict`                          | run, sync, check, inspect, export | Never uses an expired cache entry.                          |
| `--interactive`, `--no-interactive` | run, sync, check, inspect, export | Allows or forbids a prompt, such as a desktop app approval. |
| `--cache`, `--no-cache`             | run, sync, check, inspect, export | Turns the cache on or off.                                  |
| `--cache-dir <dir>`                 | every command except `--version`  | Selects the cache directory.                                |
| `--json`                            | every command except run          | Prints the report, or the error, as JSON on stdout.         |
| `--redact`, `--no-redact`           | inspect, export                   | Hides or shows the secret values.                           |
| `--format dotenv\|json`             | export                            | Selects the output format.                                  |
| `--output <file>`                   | export                            | Writes a file with the mode `0600`.                         |
| `--debug`                           | every command                     | Shows debug logs, with the duration of each step.           |
| `--log-format pretty\|json`         | every command                     | Selects the format of the logs on stderr.                   |

All logs go to stderr, so stdout stays clean for `export` and `--json`. A log never holds a secret
value.
