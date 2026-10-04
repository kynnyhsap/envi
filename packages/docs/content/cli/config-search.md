---
title: "Config search"
description: "How Envi finds envi.config.ts: up, down, or the whole repo."
---

# Config search

Without `--config` and `ENVI_CONFIG`, Envi searches for `envi.config.ts`, `.mts`, `.js`, or `.mjs`.
The project root is the nearest folder with `.git`.

- `up`: the nearest config in the working directory or an ancestor, up to the project root. Outside
  a repo, the search stops at the home folder. `run`, `check`, `inspect`, and `export` search `up`.
- `down`: every config in the working directory and below it. In a repo, git decides which files
  count, so an ignored folder is left out. Outside a repo, Envi skips `node_modules` and dot
  folders. It follows a symlink to a folder, but it visits each folder once, so a link back to
  the project or to a parent finds no config twice.
- `repo`: every config of the project, from the project root down. `sync` searches `repo`.

A command that uses one config fails with [`ManyConfigs`](../errors/config-load-many-configs.md) when the
search or the flags give several.
