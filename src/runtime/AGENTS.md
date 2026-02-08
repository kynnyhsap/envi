# Runtime

- `src/runtime/*` holds platform boundaries shared across CLI/SDK/providers (e.g. `exec`). Avoid importing SDK modules from providers to prevent dependency cycles.
