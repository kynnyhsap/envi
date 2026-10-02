---
title: "Monorepo"
description: "One config for each package, shared pieces, and the limits of a config file on Node."
---

# Monorepo

Each package that needs env has its own `envi.config.ts`. Packages share pieces through a plain
TypeScript module, such as `envi.shared.ts` at the repo root. Run `envi sync` once at the root,
and then `envi run` in each package.

`envi sync` fills one cache for every config. Each config that uses the cache must select the same
`cache.encryption` and `cache.directory`, so a shared module is a good home for the `cache` key.
Otherwise `sync` fails with a [`SettingsError`](../errors/settings.md) and writes nothing. See
[Cache](../cache.md).

A config file on Node has the limits of type stripping: no enums, no namespaces, no parameter
properties, explicit `.ts` extensions in relative imports, no tsconfig `paths`, and ESM only.
