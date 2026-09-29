---
name: "envi-setup"
description: "Set up Envi in a project: install it, write envi.config.ts from the vars that the code reads, move the secrets from .env files to references, and run the scripts through envi run. Use it when a project has no envi.config.ts yet, or when the user asks to replace .env files with Envi."
---

# Set up Envi

This skill adds Envi to a project. Use the `envi` skill for the work after the setup.

Never print or copy a secret value during the setup. Read only the keys of an env file, such as
with `cut -d= -f1 .env`, never its values.

## 1. Install

Envi needs the exact `effect` version that its peer dependency names:

```sh
npm view @kynnyhsap/envi peerDependencies.effect
```

Install Envi, the 1Password provider, and that `effect` version with the package manager of the
project:

```sh
bun add @kynnyhsap/envi @kynnyhsap/envi-1password "effect@<version>"
```

Then read the docs of the installed version: `bunx envi docs show getting-started`, or
`npx envi docs show getting-started`.

## 2. Find the vars

List every var that the code reads, such as `process.env.NAME`, `Bun.env.NAME`, and
`import.meta.env.NAME`, and the keys of `.env.example` and the other env files. In a monorepo,
list them for each package.

## 3. Pick a source for each var

- A public value, such as a port, is a literal: `PORT: "3000"`.
- A secret is a reference, such as `op("app", "postgres", "url")`. Ask the user for the vault,
  the item, and the field of each secret. Never guess them.
- A value that differs by stage uses the `stage` argument of `vars`, such as
  ``op(`op://app-${stage}/postgres/url`)``.

`envi docs show config/sources` explains the sources, the schemas, `.optional()`, and
`.default()`.

## 4. Write `envi.config.ts`

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
  }),
});
```

Ask the user for the 1Password account. In a monorepo, each package gets its own config, and the
shared parts go into a plain module: `envi docs show config/monorepo`.

## 5. Check the config

Run `envi check`. Fix each failure with its hint and `envi docs show <docs link>`. Without a
service account token, the 1Password app asks the user for an approval.

## 6. Run the scripts through Envi

Prefix each script that needs env, such as `"dev": "envi run -- next dev"`. The code keeps
reading `process.env`. For CI, read `envi docs show ci`.

## 7. Finish

Tell the user which env files Envi replaces. Let the user delete them. To point other agents at
Envi, show the user the block in `envi docs show agents`.
