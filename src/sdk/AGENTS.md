# SDK

- `createEnviEngine()` defaults to an auto runtime adapter selected by `detectRuntime()` (Bun vs Node via `process.versions.bun`).
- SDK results are safe by default: operations that surface values support `includeSecrets`; otherwise secret values are redacted.
- Canonical machine output is the JSON envelope in `src/sdk/json.ts` (used directly by CLI `--json`).
- Bun runtime adapter uses Bun-native IO + `Bun.Glob`; Bun has no `Bun.mkdir`, so `mkdirp()` uses `node:fs/promises`.
