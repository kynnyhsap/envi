---
title: "Getting started"
description: "Install Envi, write envi.config.ts, and run a command with the vars."
---

# Getting started

## Install

```sh
bun add @kynnyhsap/envi @kynnyhsap/envi-1password "effect@~4.0.0"
```

The package is `@kynnyhsap/envi`, and its command is `envi`. `effect` is a peer dependency, so the
project has one copy of it. Envi needs `effect` 4. Envi asks for the patch versions of one minor
version of `effect`, the version that its CI tests, because a minor version of Effect can break
`effect/cli`. Use that range in the project. Each Envi release moves to the newest Effect release.
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
