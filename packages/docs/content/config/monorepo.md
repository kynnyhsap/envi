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

A config file on Node has the limits of type stripping: no enums, no namespaces, no parameter
properties, explicit `.ts` extensions in relative imports, no tsconfig `paths`, and ESM only.
