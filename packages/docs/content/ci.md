---
title: "CI"
description: "Run Envi in CI: a service account token, no cache by default, and an optional shared cache."
---

# CI

- Set a service account token, such as `OP_SERVICE_ACCOUNT_TOKEN`. CI runs are not interactive,
  so the 1Password provider fails at once without a token.
- The cache is off, and every run is strict. `envi sync` says that the cache is off.
- To keep a cache between jobs, set `ENVI_CACHE_KEY` from a CI secret and `--cache` or
  `ENVI_CACHE_ENABLED=true`, and cache the directory of `ENVI_CACHE_DIR`.
- To pass secrets to the later steps of a GitHub Actions job, run
  `envi export --format github` in one step. It masks every secret of the stage and appends the
  vars to the file of `GITHUB_ENV`. `--only` limits the exported vars, and a missing name fails
  the step. See [envi export](./cli/index.md).
- In the SDK, a `cache` object option of a client or a layer turns the cache on in CI too. Use
  `cache: false` in the options to keep it off.

## GitHub Actions

```yaml
- name: Load secrets
  env:
    OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
  run: bunx envi export --stage staging --format github --only API_TOKEN --only DATABASE_URL
- name: Deploy
  run: bun run deploy
```

The step `Deploy` gets `API_TOKEN` and `DATABASE_URL` in its environment. The log of the job shows
`***` for each secret of the stage. Without `--only`, the step exports every var of the stage.
