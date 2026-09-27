# Envi

Envi is an env manager for TypeScript projects. A project defines its env in a typed
`envi.config.ts`. Envi resolves the config once from a secret provider, caches the result, and
injects the values into a runtime. 1Password is the only provider for now. The architecture stays
provider agnostic.

Envi works as a CLI (`envi`) and as an SDK with a plain TypeScript API and an Effect API. The npm
names are `@kynnyhsap/envi` and `@kynnyhsap/envi-1password` for now. The command stays `envi`.
`scripts/packages.ts` holds the names. To change them, edit that file and run `bun run rename`.
Code never spells a package name or a version: each package reads them from its manifest.

Reasons for Envi:

- Resolving secrets on every dev script run is slow and wasteful.
- Text env files such as `.env.example` are unsafe and untyped.

`README.md` holds the user docs: the config, each command, the settings, the cache, the
provider, the SDK, and one section for each error. It is the source of truth for the behavior.
Read it before you change behavior. Change it in the same change as the behavior. This file holds
the decisions and the rules for contributors.

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
- **Two primitives for code.** `derive(input, fn)` is a pure synchronous function of other
  values, and Envi never caches it. `custom({ id, from, scope, resolve })` runs effectful user
  code, and Envi caches it for the stage, the scope, the code, and the input values. Do not add
  `map`, `combine`, or `template`.
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
  global `envi` starts the local `envi` of the project. `envi` depends on
  `@effect/platform-node-shared`, pinned to the Effect version of the catalog. It does not depend
  on `@effect/platform-node`, because that package asks for `redis` as a peer, and npm installs
  every peer.
- **One version for every package.** Envi and every provider package share one version, the way
  the Effect v4 packages do. A release bumps every package together. A provider asks for `^` that
  version of Envi as its peer. A user never matches a provider version to an Envi version.
- **One place for every version.** The root `package.json` holds the version of the packages, the
  runtime floors in `engines`, and the Bun of the workspace in `packageManager`. Its
  `workspaces.catalog` holds every dependency version. Nothing copies a version by hand.
- **Stage.** A named set of env values is a stage. Use "stage" in code, flags, and docs. Do not
  use "env" or "environment" for this concept. `NODE_ENV` never selects the stage.
- **Platforms.** macOS and Linux. Windows is not supported in v1.
- **Flags follow the command.** `envi check --stage production`. Only `--debug` and
  `--log-format` are shared flags of the root. A command gets only the flags that it uses.
- **No transpiler.** Envi loads a config with a plain dynamic `import()` of the file URL, the way
  oxlint and oxfmt do. Node strips the types. The `engines` of the root manifest hold the floors
  of Node and Bun, and the `floors` job of CI tests them.
- **The core owns the cache key:** `<provider id>:<scope hash>:<reference key>`. `scope` holds
  everything outside a reference that selects its value, such as the account or the token. The
  core hashes it. The encryption binds an entry to its cache key.
- **The lock file format is frozen.** The lock file holds one integer, the time in milliseconds.
  Two worktrees can run different Envi versions against one cache. More lock data goes into a
  second file. A new lock protocol needs a new lock file name.
- **Explicit batches in the resolver.** One resolution has five ordered steps that share state:
  collect the references, read the cache, select the misses, fetch under the lock, and evaluate
  each descriptor.
- **Error docs.** Each error has `summary`, `hint`, and `docs`. The hint catalog lives in
  `Errors.ts`. `docs` links to `https://github.com/kynnyhsap/envi#error-<tag>-<reason>`. A unit
  test checks that the README has a section and the hint for each catalog entry. Update the
  README section in the same change as the catalog.
- **A throw in user code hides its message.** `derive()`, `custom()`, and `vars` show only the
  class name and the location of the throw. `CustomFailure` carries a safe message.

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
- All code runs on both Node and Bun. The core (`packages/envi/src/core`) depends only on Effect
  platform services. It never imports `@effect/platform-*` or `node:`, and it never reads `Bun` or
  `process`. A lint rule enforces this. Only the entry points of `envi` outside `core` provide the
  platform layer of `src/platform.ts` and read `process`.
- Write the test first. Tests use Effect through `@effect/vitest`. Unit tests use the in-memory
  provider. End-to-end tests work on real files and run the built CLI on Node and on Bun.
- Run `bun run verify` before you report work as done.

## Repository

One Bun workspace with two packages. They share the version of the root `package.json`, which is
not published yet. `scripts/versions.ts` enforces the version rules:

- Every package has the version and the `engines` of the root manifest.
- A package manifest uses only `catalog:` and `workspace:` specs. A provider asks for
  `workspace:^` Envi as its peer. The root manifest uses `catalog:` for every dependency that a
  package also uses.
- `effect` and every `@effect/*` entry of the catalog share one version. The `effect` entry is a
  caret range, and it is the peer range of the packages.
- Each README asks for the `effect` range of the catalog in its install command, and names the
  floors of `engines`.

- Every change goes through a pull request against `main`. Do not commit to `main` directly.
  CI must pass before a merge.

| Package                     | Folder                 | Holds                                                                    |
| --------------------------- | ---------------------- | ------------------------------------------------------------------------ |
| `@kynnyhsap/envi`           | `packages/envi`        | the core in `src/core`, the plain client, the layer, the CLI             |
| `@kynnyhsap/envi-1password` | `packages/onepassword` | `op()`, `onePasswordProvider`, and its e2e tests; peer `@kynnyhsap/envi` |

- `envi` exports a small public API from `src/index.ts`, and the test helpers from
  `@kynnyhsap/envi/testing`. Every other module of `src/core` is internal.
- A published package holds `dist`, and `src` for the declaration maps. `@kynnyhsap/envi-1password` has its
  own `README.md`. `scripts/prepack.ts` copies the root `LICENSE` into each package, and the root
  `README.md` into `envi`. `scripts/release.ts` publishes: the Bun of the workspace packs each
  package, because npm does not resolve `workspace:` and `catalog:`. npm publishes each tarball,
  because `bun publish` signs no provenance and supports no trusted publishing.
- `scripts/` holds the Effect scripts of the workspace, and Bun runs them. `scripts/build.ts`
  builds one package: `poof` removes `dist`, then `tsc` compiles `src`.
- `.github/workflows/ci.yml` runs `bun run verify` on macOS and on Linux, and the Linux images.
  Its `floors` job runs the unit and end-to-end tests on the Node and the Bun of `engines`. The
  Bun of `packageManager` installs, builds, and packs there, because an older Bun cannot read the
  lockfile. CI and the Linux images read both Bun versions from the root manifest.
- `.github/workflows/release.yml` runs when a tag `v<version>` arrives. It runs every job of CI,
  checks that the tag is on `main`, and runs `bun run release` with provenance. Its `publish` job
  uses the GitHub environment `npm`, and only a `v*` tag can use that environment. The first
  publish needs the secret `NPM_TOKEN` in that environment. After it, configure trusted
  publishing on npm for `release.yml` and the environment `npm`, and delete the token.
- `tests/e2e/` holds the end-to-end tests of the CLI and the SDK. They run the built CLI on Node
  and on Bun on real files in scoped temp folders. `fixtures/file-provider.ts` logs each batch
  to a file, so a test counts the provider calls of several processes. `package.test.ts` packs
  both packages the way `bun run release` does, installs the tarballs into a fresh project with npm
  and with Bun, and runs the command, the SDK, and `tsc` there. It needs the npm registry.
- `tests/linux/` holds two Docker images: `linux-secret-service` with GNOME Keyring, and
  `linux-bare` without a keychain. Each runs the unit tests and the end-to-end tests.
- `packages/onepassword/e2e/` holds the tests against real 1Password, with fake public vaults.
  The files run one after another, because the 1Password app rejects parallel connections.
- `examples/` holds config and SDK examples with compile-time type assertions. Change an example
  in the same change as the API.
- In the workspace, a package resolves to its source through the export condition
  `@envi/source`. A published package resolves to `dist`. The end-to-end tests run `dist`.

## Commands

- `bun dev <args>` runs the CLI from source on Bun. `bun dev:node <args>` runs it on Node.
- `bun run build` builds every package into its `dist` folder.
- `bun run rename` writes the names of `scripts/packages.ts` into every manifest, import, and doc.
  `bun run check` fails while a manifest differs from that file.
- `bun run versions` writes the root version and `engines` into every package manifest, and the
  `effect` range and the floors into every README. `bun run check` fails while a file differs or
  a rule breaks.
- To release, change the root version, run `bun run versions`, and merge the change. Then tag
  the merge commit on `main` with `v<version>`, and push the tag.
- `bun run release --tag v<version> --dry-run` packs both packages and checks them with
  `npm publish --dry-run`.
- `bun run verify` runs format check, lint, typecheck, the unit tests on Node and on Bun, and the
  end-to-end tests, all in parallel.
- `bun run test:onepassword` runs the tests against real 1Password. It needs
  `ENVI_TEST_ONEPASSWORD_TOKEN` in `.env.local`. `bun fixture:onepassword <status|setup|teardown>`
  manages the fake vaults.
- `bun run test:linux [target]` builds and runs the Linux images. It needs Docker. `bun run
verify` does not run it. CI runs each image in its own job.
- Use `bun run build` and `bun run test`. Bare `bun build` and `bun test` start Bun built-ins.
