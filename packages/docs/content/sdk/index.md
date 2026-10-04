---
title: "SDK"
description: "Load env, resolve one secret, and run every CLI operation from TypeScript with createEnvi."
---

# SDK

Every operation comes from a client of one config. The client mirrors the CLI.

```ts
import { createEnvi } from "@kynnyhsap/envi";
import config from "./envi.config.ts";

const envi = createEnvi(config);

const env = await envi.load({ stage: "production" }); // typed values
const raw = await envi.loadRaw(); // raw strings
const parsed = await envi.parse(process.env); // decodes existing strings, resolves nothing
const key = await envi.resolve(op("payments", "stripe", "secret-key")); // one secret
```

The client also has `run`, `sync`, `check`, `inspect`, `export`, and `cache.path`, `cache.list`,
and `cache.clear`. Each returns the report that `--json` prints. `syncAll(clients)` syncs several
clients with one call for each shared provider. A var that names a provider outside its own config
fails with `UnknownProvider`, as in `check`. Configs with different cache settings or `strict`
resolve in separate batches. It uses the overrides of the first client, and the cache of the first
config that uses the cache, so a client with `cache: false` never turns the cache off for the
others. Every config that uses the cache must select the same encryption and directory under those
overrides, or it rejects with a [`SettingsError`](../errors/settings.md).
`createEnvi(config, overrides)` takes `providers`, `cache`, `strict`, and `interactive`, which win
over the config. The `cache` override replaces the whole `cache` key of the config: `false` turns
the cache off, and an object turns a `cache: false` of the config into a cache with these
settings.

- Envi never changes `process.env`. The caller assigns the result of `loadRaw`.
- `Env<typeof config>`, `RawEnv<typeof config>`, and `StageOf<typeof config>` are the types of a
  config. `schemaOf(config, stage)` returns its `Schema`.
- A method rejects with a tagged error. Each error has `summary`, `hint`, and `docs`.
