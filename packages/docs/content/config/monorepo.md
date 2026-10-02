---
title: "Monorepo"
description: "One config for each package, shared pieces, and the limits of a config file on Node."
---

# Monorepo

Each package that needs env has its own `envi.config.ts`. Packages share pieces through a plain
TypeScript module, such as `envi.shared.ts` at the repo root. Run `envi sync` once at the root,
and then `envi run` in each package.

`envi sync` makes one call for each provider that several configs share. Each config still
resolves only against its own `providers`. A var that names a provider of another config fails
with [UnknownProvider](../errors/provider-unknown-provider.md), as `envi check` of its config does,
and the sync report lists it with its config.

A config file on Node has the limits of type stripping: no enums, no namespaces, no parameter
properties, explicit `.ts` extensions in relative imports, no tsconfig `paths`, and ESM only.
