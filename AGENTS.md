# Envi

Envi is an env manager for TypeScript projects. A project defines its env in a typed
`envi.config.ts`. Envi resolves the config once from a secret provider, caches the result, and
injects the values into a runtime. 1Password is the only provider for now. The architecture stays
provider agnostic.

Envi works as a CLI (`envi`) and as an SDK with a plain TypeScript API and an Effect API. The npm
package name is not decided, so code must not depend on the package name.

Reasons for Envi:

- Resolving secrets on every dev script run is slow and wasteful.
- Text env files such as `.env.example` are unsafe and untyped.

`docs/design.md` holds the detailed design: the config format, each command, the provider
interface, the resolver, the cache, and the test suites. Read it before you change behavior.
Change it in the same change as the behavior. Keep implementation details out of this file.

## Use cases

Every design decision must serve at least one of these use cases.

1. A user copies a monorepo to a new worktree, sets up env once, and runs the whole stack.
2. A user refreshes env on demand. Envi also refreshes env after the cache expires.
3. A program loads env through the SDK.
4. A program resolves one secret through the SDK.
5. Application code uses the config and its schemas as types.
6. The CLI and the SDK work in CI, not only on a local machine.

## Privacy

This repository is public. These rules have no exception.

- Never write a real private project into this repository: not its name, its files, its config,
  its vault names, its item names, its field names, its URLs, or its identifiers. This covers
  code, examples, tests, docs, review reports, and commit messages.
- Never write a real account name, such as a 1Password account, an email address, or a team name.
- Every example uses generic names: the account `my-team`, vaults such as `app` and `payments`,
  items such as `postgres` and `stripe`.
- A test against a real service reads every real value from an environment variable, such as
  `ENVI_TEST_ONEPASSWORD_TOKEN`. The test skips itself when the variable is missing. No real
  value has a default in the code. Local values live in the ignored file `.env.local`.
- A study of a real project stays in the chat. Do not save it to a file in this repository.
- Never read or print a resolved secret value of the user.
- Before each commit, read the staged diff and check it against these rules.

## Design decisions

- **Trust model.** The cache serves the same trust level as a `.env` file. Any process of the OS
  user, including a coding agent, can use it. Encryption protects the cache files against file
  reads, searches, and backups. Do not add features, warnings, or special cases that try to
  isolate agents or stages from the cache.
- **The config is data.** `vars` returns only literals and descriptors. It never resolves a
  secret and does no I/O. The key is `vars`, not `env` or `envs`. There is one `defineConfig`.
- **One primitive for code.** `custom({ key, from, resolve })` is the only primitive for custom
  and derived values. Do not add `derive`, `map`, `combine`, or `template`.
- **Batches.** Envi makes one call per provider for each operation. Never resolve references
  one by one in a loop. The resolver uses explicit batches, not `Request` and `RequestResolver`.
- **One client, one config.** Every SDK operation comes from `createEnvi(config, overrides?)`. No
  top-level `load` and no default instance exist. The client mirrors the CLI.
- **Envi never changes `process.env`.** Do not add a helper that only saves the user one line.
- **Provider agnostic core.** The core never imports a provider. The provider interface and the
  cache interface are public and unstable until a second real provider proves them.
- **No secret in an error or a log.** An error holds the var key or the safe `describe()` text,
  never a value or a rejected input.
- **Never fall back from encryption to plaintext.** Plaintext is an explicit opt-in.
- **One precedence order for every setting:** CLI flag or call option, client option,
  environment variable, config key, default.
- **One copy of `effect`.** `effect` is a required peer dependency. The build never bundles. A
  global `envi` starts the local `envi` of the project.
- **Stage.** A named set of env values is a stage. Use "stage" in code, flags, and docs. Do not
  use "env" or "environment" for this concept. `NODE_ENV` never selects the stage.
- **Platforms.** macOS and Linux. Windows is not supported in v1.

## Code rules

- Envi is Effect native and Effect first. All source code uses Effect v4. Every operation exists
  first as an Effect on a service. The plain TypeScript API is a thin wrapper that runs those
  Effects. It holds no logic of its own, and it rejects with the same tagged errors.
- Use the Effect building blocks instead of custom code: `Context.Service` and `Layer` for every
  dependency, `Schema` for every data structure, `Schema.TaggedError` for every error, `Config`
  for every `ENVI_*` variable, `Redacted` for every secret value in memory, `Duration` for time,
  the Effect logger, `effect/unstable/cli`, and the platform services. Do not use `async`
  functions, `try`/`catch`, or `throw` in `src`.
- Design data first. Define each data structure as an Effect `Schema`. Derive every type from its
  schema.
- Do not use magic strings. Define each closed set of values once, as a constant object plus a
  `Schema`, such as `ExportFormat.Dotenv`.
- Prefer a small set of strong primitives. Do not add a custom helper when plain TypeScript or a
  built-in Effect function does the job. Do not add a special case without a real use case.
- All code runs on both Node and Bun. The core depends only on Effect platform services. It never
  imports `@effect/platform-*`, `node:`, or `Bun.*`. Only the `envi` package provides the
  platform layer and reads `process`.
- Write the test first. Tests use Effect through `@effect/vitest`. Unit tests use the in-memory
  provider. End-to-end tests work on real files and run the built CLI on Node and on Bun.
- Run `bun run verify` before you report work as done.

## Repository

One Bun workspace with three packages. All three share one version. Shared dependency versions
come from `workspaces.catalog` in the root `package.json`.

| Package           | Folder                 | Holds                                            |
| ----------------- | ---------------------- | ------------------------------------------------ |
| `@envi/core`      | `packages/core`        | all logic, as Effect services                    |
| `@envi/1password` | `packages/onepassword` | `op()`, `onePasswordProvider`, and its e2e tests |
| `envi`            | `packages/envi`        | the plain client, the platform layer, the CLI    |

- `tests/e2e/` holds the end-to-end tests of the CLI and the SDK.
- `examples/` holds config and SDK examples with compile-time type assertions. Change an example
  in the same change as the API.
- In the workspace, a package resolves to its source through the export condition
  `@envi/source`. A published package resolves to `dist`. The end-to-end tests run `dist`.

## Commands

- `bun dev <args>` runs the CLI from source on Bun. `bun dev:node <args>` runs it on Node.
- `bun run build` builds every package into its `dist` folder.
- `bun run verify` runs format check, lint, typecheck, the unit tests on Node and on Bun, and the
  end-to-end tests.
- `bun run test:onepassword` runs the tests against real 1Password. It needs
  `ENVI_TEST_ONEPASSWORD_TOKEN` in `.env.local`. `bun fixture:onepassword <status|setup|teardown>`
  manages the fake vaults.
- Use `bun run build` and `bun run test`. Bare `bun build` and `bun test` start Bun built-ins.
