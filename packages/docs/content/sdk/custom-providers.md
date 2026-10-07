---
title: "Custom providers and caches"
description: "Build a provider with Provider.make, or a cache as a layer of Cache.Cache."
---

# Custom providers and caches

`Provider.make({ id, Reference, describe, scope, resolveMany, helpers })` builds a provider.
`resolveMany` resolves a whole batch in one call. The optional `discover(queries, context)` lists
the references whose names match each query, best match first, for [`envi find`](../cli/find.md).
It gets every query in one call, and it must return and log no value. `reference(id, ref)` builds a
descriptor for it.
A custom cache is a layer of the `Cache.Cache` service. It can also provide `Cache.Status`, which
gives `cache path` its directory and tells `sync` whether the cache stores values. Both interfaces
are public and unstable
until a second real provider proves them. [`examples/sdk-custom-provider.ts`](https://github.com/kynnyhsap/envi/blob/main/examples/sdk-custom-provider.ts) shows a provider.

`@kynnyhsap/envi/testing` exports `memoryProvider` and `mem` for tests.
