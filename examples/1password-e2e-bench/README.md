# 1Password E2E Benchmark Vault

This example is wired to the live `envi-test` 1Password vault and is meant for performance work.

## What it benchmarks

- Real secret resolution through 1Password CLI service account auth
- `sync` dry-run latency
- `diff` latency
- `run` environment resolution latency

The benchmark compares two resolver modes:

- `resolveMode=sequential` (baseline behavior)
- `resolveMode=batch` (optimized behavior)

## Prerequisites

1. `OP_SERVICE_ACCOUNT_TOKEN` must have read access to vault `envi-test`
2. Vault must contain these items:
   - `api-envs`
   - `web-envs`
   - `app-envs`
   - `dash-envs`
   - `worker-envs`
   - `ops-envs`

## Run benchmark

From repo root:

```bash
OP_SERVICE_ACCOUNT_TOKEN="..." bun run examples/1password-e2e-bench/bench.ts
```

Or via package script:

```bash
OP_SERVICE_ACCOUNT_TOKEN="..." bun run bench:e2e
```

## Tune workload

You can scale benchmark size without editing files:

```bash
ENVI_BENCH_APP_COUNT=80 ENVI_BENCH_ITERATIONS=7 ENVI_BENCH_WARMUP=2 \
OP_SERVICE_ACCOUNT_TOKEN="..." bun run bench:e2e
```

- `ENVI_BENCH_APP_COUNT` (default: `40`) controls generated app templates
- `ENVI_BENCH_ITERATIONS` (default: `5`) controls measured runs per mode
- `ENVI_BENCH_WARMUP` (default: `1`) controls warmup runs per mode
