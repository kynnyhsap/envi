---
title: "ExportFileError NoGithubEnv"
description: "`envi export --format github` runs without `GITHUB_ENV`, outside a GitHub Actions step."
---

# ExportFileError NoGithubEnv

`envi export --format github` appends the vars to the file that `GITHUB_ENV` names. The GitHub
Actions runner sets `GITHUB_ENV` in each step. Without it, Envi resolves nothing, prints nothing,
and writes nothing.

Next action: Run `--format github` in a step of GitHub Actions, which sets `GITHUB_ENV`. Elsewhere, use `--format dotenv` or `--format json`.
