---
title: "Getting started"
description: "Install Envi, write envi.config.ts, and run a command with the vars."
---

# Getting started

## Install

```sh
bun add @kynnyhsap/envi @kynnyhsap/envi-1password
```

The package is `@kynnyhsap/envi`, and its command is `envi`. Envi asks for `effect@~4.0.0` as a
peer dependency, so the project and Envi share one copy of `effect`. npm, pnpm, and Bun install
`effect` with Envi when the project has none. A project that uses Effect keeps its own version:
Envi accepts every patch of that range. A minor version of Effect can break `effect/cli`, so a new
minor version needs a new Envi release. The config imports `effect/Schema`. The default linker of
pnpm hides a package that the project does not list, so add `effect@~4.0.0` to a pnpm project.
`@kynnyhsap/envi-1password` installs `@1password/sdk`. A global `envi` starts the local `envi` of
the project.

## Quick start

Create `envi.config.ts` at the root of the project:

```ts
import * as Schema from "effect/Schema";
import { defineConfig } from "@kynnyhsap/envi";
import { onePasswordProvider } from "@kynnyhsap/envi-1password";

export default defineConfig({
  stages: ["development", "production"],
  providers: [onePasswordProvider({ account: "my-team" })],
  vars: ({ stage, op, value }) => ({
    PORT: value("3000").schema(Schema.FiniteFromString),
    DATABASE_URL: op(`op://app-${stage}/postgres/url`),
    STRIPE_KEY: op("payments", "stripe", "secret-key"),
  }),
});
```

Run a command with the vars:

```sh
envi run -- bun dev
```

The first run resolves every secret in one batch and fills the cache. The next runs read the
cache. `envi check` validates every var and shows no value.
