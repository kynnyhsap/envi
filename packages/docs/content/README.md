---
title: "Envi docs"
description: "The docs of Envi, the typed env manager for TypeScript projects. Start here."
---

# Envi docs

Envi is an env manager for TypeScript projects. A project defines its env in a typed
`envi.config.ts`. Envi resolves the config once from a secret provider, caches the result, and
injects the values into a runtime. It works as a CLI (`envi`) and as an SDK.

These docs match the version of Envi that ships them. The npm package holds them in its `docs`
folder. Read the smallest page that answers the task.

## Pages by task

| Task                                                      | Page                                                     |
| --------------------------------------------------------- | -------------------------------------------------------- |
| Install Envi and write a first config                     | [Getting started](./getting-started.md)                  |
| Learn the keys of `defineConfig`, the stages, and `vars`  | [Config](./config/index.md)                              |
| Pick a source for a var, or decode, default, or redact it | [Sources](./config/sources.md)                           |
| Compute a var from other values                           | [derive and custom](./config/derive-and-custom.md)       |
| Set up env in a monorepo or a new worktree                | [Monorepo](./config/monorepo.md)                         |
| Find a command or a flag                                  | [CLI](./cli/index.md)                                    |
| Understand which config a command uses                    | [Config search](./cli/config-search.md)                  |
| Run a command with the vars                               | [envi run](./cli/run.md)                                 |
| Find an environment variable or the order of the settings | [Settings](./settings.md)                                |
| Understand the cache, its expiry, and its encryption      | [Cache](./cache.md)                                      |
| Use 1Password references, tokens, or the desktop app      | [1Password](./providers/1password.md)                    |
| Run Envi in CI                                            | [CI](./ci.md)                                            |
| Load env or resolve one secret from TypeScript            | [SDK](./sdk/index.md)                                    |
| Use Envi from Effect code                                 | [Effect](./sdk/effect.md)                                |
| Write a provider or a cache                               | [Custom providers and caches](./sdk/custom-providers.md) |
| Check a known limit                                       | [Known limits](./known-limits.md)                        |
| Fix an error                                              | [Errors](./errors/index.md), then the page of the error  |

## Errors

Every error has a `docs` link to its page in [`errors`](./errors/index.md). A link such as
`.../content/errors/vars.md` names the page `errors/vars.md` of these docs.
