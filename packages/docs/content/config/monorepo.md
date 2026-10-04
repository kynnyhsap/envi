---
title: "Monorepo"
description: "One config for each package, shared pieces, and the limits of a config file on Node."
---

# Monorepo

Each package that needs env has its own `envi.config.ts`. Packages share pieces through a plain
TypeScript module, such as `envi.shared.ts` at the repo root. Run `envi sync` once at the root,
and then `envi run` in each package.

`envi sync` resolves the configs together, with one call for each shared provider. Configs share a
batch when they have the same stage, the same provider instances, the same cache settings, and the
same `strict`. Configs with different cache settings or `strict` resolve in separate batches, so
each config gets the cache and the stale fallback of a run of that config alone.

Each config still resolves only against its own `providers`. A var that names a provider of
another config fails with [UnknownProvider](../errors/provider-unknown-provider.md), as `envi check`
of its config does, and the sync report lists it with its config.

`envi sync` fills one cache for every config. Each config that uses the cache must select the same
`cache.encryption` and `cache.directory`, so a shared module is a good home for the `cache` key.
Otherwise `sync` fails with a [`SettingsError`](../errors/settings.md) and writes nothing. See
[Cache](../cache.md).

A config file on Node has the limits of type stripping: no enums, no namespaces, no parameter
properties, explicit `.ts` extensions in relative imports, no tsconfig `paths`, and ESM only.
