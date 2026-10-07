---
title: "Effect"
description: "Every operation as an Effect on the Envi service, and the layer that provides it."
---

# Effect

Every operation is an Effect on the `Envi` service. The plain client runs these Effects.

```ts
import * as Effect from "effect/Effect";
import { Envi, layer } from "@kynnyhsap/envi";

const program = Effect.gen(function* () {
  const envi = yield* Envi.Envi;

  return yield* envi.load(config, { stage: "production" });
});

program.pipe(Effect.provide(layer({ strict: true })));
```

`layer(options)` provides the default cache, the environment and the signals of the process, and
the platform services of Node or Bun. The layer serves any config, so the cache directory and the
encryption come from `options.cache`. The `cache` key of each config still sets its `ttl`, its
`maxStale`, and `false`, unless `options.cache` replaces it. An object in `options.cache` turns
the cache on over `ENVI_CACHE_ENABLED` and the default of CI, and a missing key then only logs a
warning. `sync` of several configs still
requires that every config that uses the cache selects the same encryption and directory. See
[Cache](../cache.md).
