---
title: "ConfigLoadError NoConfig"
description: "The config search found no config file."
---

# ConfigLoadError NoConfig

The config search found no config file. `up` looks in the working directory and its ancestors up to the project root, or up to the home folder outside a repo. `down` and `repo` look below a folder.

Next action: Create `envi.config.ts` in the project, pass `--config <file>`, or search in another direction with `--config-search`.
