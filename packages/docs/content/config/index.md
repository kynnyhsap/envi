---
title: "Config"
description: "The keys of defineConfig, the vars function, and the stages."
---

# Config

`defineConfig` takes one object. Every key is optional.

| Key            | Holds                                                                                 |
| -------------- | ------------------------------------------------------------------------------------- |
| `stages`       | The names of the stages. `stage` gets a union type, and Envi rejects any other stage. |
| `defaultStage` | The stage without `--stage` and `ENVI_STAGE`. Default: `development`.                 |
| `providers`    | The provider instances, such as `onePasswordProvider()`.                              |
| `cache`        | `false`, or `{ ttl, maxStale, directory, encryption }`. See [Cache](../cache.md).     |
| `strict`       | `true` never uses an expired cache entry.                                             |
| `vars`         | A plain object, or a synchronous function of the stage.                               |

`vars` returns only literals and descriptors. It never resolves a secret and does no I/O, so
`check`, `parse`, and `schemaOf` read a config without a provider call. The function receives the
stage, the built-in helpers, and the helpers of each provider, such as `op`. A config file then
needs no helper import.

A stage is a named set of env values. Envi selects the stage in this order: `--stage`,
`ENVI_STAGE`, `defaultStage`, `development`. `NODE_ENV` never selects the stage. `envi run` passes
`ENVI_STAGE` to the child.
