# Envi design

This file holds the detailed design of Envi: the config format, each surface, the provider
interface, the resolver, the cache, and the test suites. `AGENTS.md` holds the purpose, the rules
for agents, and the main decisions. Change this file in the same change as the behavior.

## Config file

The config file is `envi.config.ts`. `defineConfig` takes one object.

```ts
import * as Schema from "effect/Schema";
import { defineConfig } from "envi";
import { onePasswordProvider } from "@envi/1password";

export default defineConfig({
  stages: ["development", "staging", "production"],
  defaultStage: "development",
  providers: [onePasswordProvider({ account: "my-team" })],
  cache: { ttl: "24 hours", maxStale: "7 days" },
  vars: ({ stage, op, value }) => ({
    NODE_ENV: stage === "production" ? "production" : "development",
    PORT: value("3000").schema(Schema.NumberFromString),
    DATABASE_URL: op(`op://app-${stage}/postgres/url`),
    STRIPE_KEY: op("payments", "stripe", "secret-key"),
    SENTRY_DSN: op({
      vault: "observability",
      item: "sentry",
      section: "web",
      field: "dsn",
    }).optional(),
  }),
});
```

- `vars` is a plain object or a synchronous function of the stage. It returns only literals and
  descriptors. It never resolves a secret and does no I/O. Every config is therefore inspectable
  data: `parse`, `check`, `sync`, and `schemaOf` work without any provider call.
- `vars` receives one parameter: the stage, the built-in helpers `value`, `custom`, `fromEnv`, and
  `reference`, and the helpers of each provider in `providers`, such as `op`. A config file then
  needs no helper import. A provider package also exports its helper, because a shared module sits
  outside `vars`. Both forms give the same function.
- The key for the env vars is `vars`. Do not name it `env` or `envs`.
- `stages` is an optional plain array. It gives `stage` a union type, and Envi rejects any other
  stage. Without `stages`, a stage is any string.
- Envi picks the stage in this order: `--stage`, `ENVI_STAGE`, `defaultStage`, `"development"`.
  `NODE_ENV` never selects the stage. `envi run` injects `ENVI_STAGE` into the child process.
- `providers` is a list of provider instances from the provider packages. The CLI uses this list.
- `op()` returns a descriptor. It does not resolve a value and does not import 1Password code.
- `op()` accepts three forms: a reference string, `(vault, item, field)`, and an object. One
  parser turns all three forms into one normalized `OpReference` with the fields `account`,
  `vault`, `item`, `section`, and `field`. Envi does not support the `otp` attribute.
- A descriptor has chained methods: `.schema()`, `.optional()`, `.default()`, `.redact()`, and
  `.cache()`. Each
  method returns a new descriptor. `.schema()` takes only an Effect `Schema` that encodes to a
  string. Without `.schema()`, the value is a `string`.
- `.optional()` and `.default()` apply only when the provider reports `NotFound`. Every other
  failure stays a failure. A `.default()` value passes through the schema.
- `.cache(false)` resolves a value on every load. `.cache({ ttl, maxStale })` overrides the cache
  settings for one value.
- `custom({ key, from, resolve })` takes a value from user code. It is the only primitive for
  custom and derived values. Do not add `derive`, `map`, `combine`, or `template`.
  - `from` holds the inputs as descriptors, not as var names. Envi collects every reference,
    resolves one batch for each provider, and then runs each `resolve` from the inside to the
    outside. An input can be another `custom()`. A cycle is impossible by construction.
  - `resolve` receives the decoded inputs. It returns the raw string, a `Promise`, or an `Effect`
    without requirements. A failure becomes a `ProviderError` for the provider `custom`.
  - With a `key`, Envi caches the result under that key. Without a `key`, Envi never caches it.
  - An input does not have to be a var. `envi run` injects only the vars.
- A reference address or a var name that depends on a resolved value is out of scope for v1.
- `fromEnv(name)` takes a value from the environment of the Envi process, such as a CI secret. Envi
  never caches it. A missing variable counts as `NotFound`.
- Envi keeps the raw string next to the decoded value. It never rebuilds a raw string from a
  decoded value.
- In a monorepo, each workspace package that needs env has its own `envi.config.ts`. Packages share
  pieces through a plain TypeScript module, such as `envi.shared.ts` at the repo root. The
  workflow is `envi sync` at the root, then one `envi run` per package. `envi run` uses one config.
- There is one `defineConfig`. An effectful config variant does not exist, and `defineConfig` is
  not a function of the stage. `custom()` covers a value that needs code or I/O.
- `vars` is optional. A config without `vars` serves a client that only calls `resolve`.

## Config loading

- The CLI accepts `--config` several times. A path can have any file name with a `.ts`, `.mts`,
  `.js`, or `.mjs` extension. `ENVI_CONFIG` holds a comma-separated list. Without both, `envi run`
  uses the nearest `envi.config.ts`, and `envi sync` finds configs through `workspaces` in the root
  `package.json`.
- Envi loads a config file the way oxlint and oxfmt do: a plain dynamic `import()` of the file URL,
  with a `?cache=<key>` query. Envi ships no transpiler. On Node, TypeScript configs require Node
  `>=22.18.0`, and a dependency of `@effect/platform-node` requires `>=22.19.0`. The floor of Envi
  is `>=22.19.0`. If the import fails with `ERR_UNKNOWN_FILE_EXTENSION`, Envi reports the required
  Node version.
- A config file on Node has the limits of type stripping: no enums, no namespaces, no parameter
  properties, explicit `.ts` extensions in relative imports, no tsconfig `paths`, and ESM only.

## Surfaces

Envi works in two ways. Both share one core.

- **SDK.** Every operation comes from a client: `createEnvi(config, overrides?)`. A client binds
  one config. The config is the single source of settings for the CLI and the SDK, and `overrides`
  wins over it. No top-level `load` and no default instance exist.
- **CLI.** The v1 commands are `run`, `sync`, `inspect`, `check`, `export`, and `cache` with the
  subcommands `path`, `list`, and `clear`.
- The client mirrors the CLI. It has `run`, `sync`, `check`, `inspect`, `export`, and
  `cache.path/list/clear`, plus the SDK-only `load`, `loadRaw`, `parse`, and `resolve`. `syncAll`
  takes a list of clients and makes one batch for each provider.
- Each command has a report `Schema` in `reports.ts`, such as `SyncReport`. The SDK method returns
  the report. The CLI renders it as text, and `--json` prints the encoded report on stdout. Every
  command except `run` accepts `--json`, because the stdout of `run` belongs to the child.
  `envi export --json` means `--format json`. `--json` also sets `--log-format json`.
- The Effect `Envi` service has the same operations. It takes the config as an argument, because a
  service cannot carry a type parameter. Its `sync` takes one config or a list.

SDK rules:

- `load` always resolves. `parse` never resolves: it decodes strings that already exist.
- Envi never changes `process.env`. `loadRaw` returns the raw strings, and the caller assigns them.
  Do not add a helper that only saves the user one line of code.
- A client uses the providers of its config, unless `overrides.providers` replaces them. Tests
  pass an in-memory provider this way.
- `sync` and `check` return a report that lists each failed var. They do not reject for a failed
  var. `load` rejects.
- `schemaOf(config, { stage })` returns the `Schema` of a config. `Env<C>`, `RawEnv<C>`, and
  `StageOf<C>` are the derived types.
- `export` returns real values. `redact: true` and `--redact` hide the secret values. `inspect`
  redacts by default.
- The v1 export formats are `dotenv` and `json`. A format that cannot represent a value fails.
  `envi export` writes to stdout by default. `--output <file>` writes a file with mode `0600`.
  Envi asks `git check-ignore` first and refuses a file that git does not ignore. A folder
  outside a git repository passes. `ExportFile.write` in the core holds this logic.

`envi run` rules:

- The child gets the parent environment plus the resolved vars. A resolved var wins over an
  inherited var.
- Envi removes `OP_SERVICE_ACCOUNT_TOKEN` and every `ENVI_PROVIDER_*` variable from the child.
- Envi resolves and validates all vars before it starts the child. A failure starts no child.
- Envi forwards signals to the child and returns the exit code of the child. The child stays in
  the process group of Envi (`detached: false`), so it keeps the terminal. Envi forwards
  `SIGTERM` and `SIGHUP`. It forwards `SIGINT` only without a terminal, because a terminal sends
  `SIGINT` to the whole process group. A child that a received signal ends gives `128 + number`.
- `Signals.supervise` in the core holds this logic. The delegation from a global `envi` uses it
  too. The `envi` package provides the real signals. It installs a handler only while a child
  runs.
- Envi keeps `ENVI_DELEGATED` out of the child, so a nested `envi` finds its own installation.

## Providers

- The core never imports a provider. A provider package exports a descriptor helper, such as
  `op()`, and a provider factory, such as `onePasswordProvider(settings)`.
- A provider has five required members: `id`, `Reference`, `describe`, `cacheKey`, and
  `resolveMany`. The optional `helpers` member holds the descriptor helpers that `vars` receives.
  Users can write a custom provider with `Provider.make`, and a descriptor
  helper with `reference(id, ref)`. The provider interface and the cache interface are public and
  **unstable** until a second real provider proves them. Rate limits and retry metadata come later.
- `resolveMany` is the only resolve method. Results are matched by request key, not by position.
  Envi rejects a missing key and an unknown key.
- `cacheKey` belongs to the provider. It contains every part that decides where a value comes
  from. For 1Password: the account, the credential kind, and the normalized reference. All three
  `op()` forms give the same key.
- `describe` returns safe text for a reference, such as `op://app/postgres/url`. Envi shows it in
  `inspect`, `check`, `sync`, `cache list`, error values, and debug logs. It never holds a secret.
- The provider registry rejects a duplicate provider id.
- A provider receives `interactive: false` in CI. Provider-specific CI logic lives in the
  provider. The 1Password provider never uses desktop authentication in CI, and it fails at once
  without a token.
- The 1Password provider uses `@1password/sdk` and does not depend on the `op` CLI. It imports the
  SDK lazily and creates the client only on a cache miss, because client creation takes 2 to 5
  seconds. `serviceAccountToken` is a plain string. Desktop auth and `secrets.resolveAll` are
  verified on Node `24.18.0` and Bun `1.4.2` with `@1password/sdk@0.5.0`.
- Environment variables for a provider follow `ENVI_PROVIDER_<ID>_<SETTING>`, such as
  `ENVI_PROVIDER_ONEPASSWORD_ACCOUNT`. The 1Password provider also reads
  `OP_SERVICE_ACCOUNT_TOKEN`, with lower priority.
- Unit tests use the in-memory provider. A separate test suite runs against real 1Password. It
  reads the account and the references from environment variables. See "Privacy".

## Resolving and the cache

- Resolve in batches: one call per provider for each `load`, `sync`, or `resolve` record. Never
  resolve references one by one in a loop.
- The cache is global, in `~/.cache/envi/`, with one entry per secret. It stores only resolved
  secrets. Literal values never enter the cache. Parallel worktrees with different configs share
  entries. The directory is configurable: `--cache-dir`, `ENVI_CACHE_DIR`, or `cache.directory`.
- The cache is a service with a file layer, a memory layer, a disabled layer, and support for a
  custom cache. The logical cache record holds the value plus freshness metadata. Encryption is
  private to the file layer.
- The file layer encrypts each entry with AES-256-GCM through WebCrypto. The key lives in the
  macOS Keychain. The encryption binds the entry to its cache key, so an entry that someone moved,
  edited, or replaced fails to decrypt. Envi never falls back from encryption to plaintext on its
  own. `encryption: "none"` is an explicit opt-in and writes files with mode `0600`.
- Envi creates the cache directory with mode `0700` and writes entries with a temp file and a
  rename.
- An entry expires after `ttl`, 24 hours by default. If the refresh of an expired entry fails with
  a transient failure, Envi uses the expired value, up to `maxStale`, 7 days by default, and logs a
  warning. Transient means offline, a timeout, or a prompt that nobody approved. `NotFound`,
  `AccessDenied`, `Invalid`, and an entry that fails its integrity check never allow the fallback.
  `--strict` disables the fallback. CI is always strict.
- The lock protocol: read the cache, take the lock, read the cache again, create the client,
  resolve the misses, write, release. The lock has a bounded wait and recovers from a crashed
  owner. The lock file always holds a complete time: Envi writes a temp file, and then links it
  to take the lock or renames it to renew the lock. A reader that sees an empty lock file would
  treat the lock as crashed and steal it.
- The content of the lock file is frozen: one integer, the time in milliseconds. Two worktrees can
  run different Envi versions against one cache. More lock data goes into a second file. A new
  lock protocol needs a new lock file name.
- A cache entry has no single expiry. Each reader applies the `ttl` of its own config to
  `resolvedAt`. `cache list` therefore shows `resolvedAt` and no expiry column.
- A `custom()` value that comes from an expired input is itself expired. Envi never caches it,
  and its origin is `stale-cache`.
- The cache is off by default when `CI=true`. `--cache` or `ENVI_CACHE_ENABLED=true` turns it on.
- Supported platforms: macOS and Linux. Windows is not supported in v1. On Linux, the cache is off
  by default until a keychain layer exists.

## Resolver

`Resolver.resolve` does one explicit batch for each provider. It does not use `Request` and
`RequestResolver`, because one resolution has five ordered steps that share state: collect the
references, read the cache, select the misses, fetch under the lock, and evaluate each
descriptor. A fresh `custom()` entry hides its inputs from the batch.

## Errors and logs

- Every error is a tagged error with a reason code. An error never holds a secret value or a
  rejected input. It holds the var key or the `describe()` text.
- The CLI logs through the Effect structured logger. All logs go to stderr, so stdout stays clean
  for `export`. `--debug` shows debug logs: the cache read, each provider batch with its safe
  reference texts, a provider failure, and a schema message. A schema message can quote the
  rejected value, so a redacted var never shows it. `--log-format`
  selects `pretty` or `json`.
- `--debug` also shows how long each step takes. `Timing.measure(step)` wraps a step and writes
  one debug line when the step ends: `message="Envi finished a step."` with `step`, `durationMs`,
  `outcome` (`success` or `failure`), and safe annotations. A new slow step gets a
  `Timing.measure`. The steps:

  | Step                     | Covers                                                       |
  | ------------------------ | ------------------------------------------------------------ |
  | `startup`                | the start of the runtime and the imports, before the command |
  | `command`                | one whole CLI command, with its name                         |
  | `config.import`          | the `import()` of one config file                            |
  | `keychain.key`           | the read, or the creation, of the key in the macOS Keychain  |
  | `cache.read`             | the first cache read                                         |
  | `resolve.lock`           | the locked section, including the wait for the lock          |
  | `provider.resolve`       | one batch of one provider                                    |
  | `cache.write`            | the write of the fetched entries                             |
  | `custom.resolve`         | one `custom()`, including the evaluation of its inputs       |
  | `run.child`              | the child of `envi run`, from the spawn to the exit          |
  | `onepassword.sdk.import` | the lazy import of `@1password/sdk`                          |
  | `onepassword.client`     | the creation of one SDK client, including a desktop approval |
  | `onepassword.resolveAll` | one `secrets.resolveAll` call                                |

- Every setting follows one precedence order: CLI flag or call option, client option, environment
  variable, config key, default.

## Repository structure

The repo is one Bun workspace with three published packages. All three share one version and
release together. The package names are placeholders until the npm name is decided.

| Package           | Folder                 | Holds                                            | Depends on                                                     |
| ----------------- | ---------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| `@envi/core`      | `packages/core`        | all logic, as Effect services                    | peer: `effect`                                                 |
| `@envi/1password` | `packages/onepassword` | `op()` and `onePasswordProvider`                 | peer: `@envi/core`, `effect`. Regular: `@1password/sdk`        |
| `envi`            | `packages/envi`        | the plain client, the runtime layer, and the CLI | peer: `effect`. Regular: `@envi/core`, `@effect/platform-node` |

- `core` holds the descriptors, `defineConfig`, the config loader, the provider registry, the
  resolver, the cache with its layers, the keychain layer, the `Envi` service with `run`, the
  reports, the errors, the in-memory provider, and the built-in providers `custom` and `fromEnv`.
  `core` owns every shared type. `core` never imports a provider package, `@effect/platform-*`,
  `node:`, or `Bun.*`. It requires the platform services and does not provide them.
- `envi` is the only package that provides the platform layer. It uses `@effect/platform-node` on
  both Node and Bun, because Bun implements the Node APIs. Do not add `@effect/platform-bun`. The
  plain client and the CLI share this layer. An import of
  `envi` installs no signal handler and starts nothing.
- `envi` never imports `@envi/1password`. The CLI gets each provider instance from the config file.
- The CLI and the plain client stay in one package. A separate CLI package saves no dependency
  and allows a version mismatch between the CLI and the SDK in one project.
- `effect` is a required peer dependency of every package. It is not optional. A project must hold
  exactly one copy of `effect`, because a `Schema` or a `Redacted` value from one copy fails in a
  second copy. The Schema parser of `effect` holds a module-local `Symbol()`, and `Redacted` holds
  a module-local `WeakMap`.
- The build never bundles. Each package emits ESM modules and `.d.ts` files with `tsc`. A bundle
  could hold a second copy of `effect` or of `core`.
- A global `envi` starts the local `envi` of the project before it loads a config. It searches
  `node_modules/envi` from the working directory upward. Without a local installation, the
  import of the config fails with `ERR_MODULE_NOT_FOUND`, and Envi reports the reason
  `MissingDependency` with an install hint.
- Every version of a shared dependency comes from `workspaces.catalog` in the root `package.json`.
  A package refers to it with `catalog:`. A workspace package refers to another with
  `workspace:*`. `bun pm pack` writes the real versions into the packed `package.json`.
- In the workspace, a package resolves to its source through the export condition `@envi/source`.
  `tsconfig.json`, `vitest.config.ts`, `bun dev`, and `bun dev:node` set this condition. A
  published package resolves to `dist`. The end-to-end tests run the built `dist` files.
- The cache format on disk has a version, because two worktrees can run different Envi versions.
- Appending `?cache=<key>` to a config URL does not reload a module that the config imports.

## End-to-end tests

`tests/e2e/` runs the built CLI on Node and on Bun, and the SDK, on real files in scoped temp
folders. `fixtures/file-provider.ts` is a custom provider over a real secrets file. It appends
each batch to a real log file, so a test counts the provider calls of several processes.

The unit tests run twice: `bun test:unit` runs the workers on Node, and `bun test:unit:bun` runs
them on Bun.

- `cli.test.ts`, `config.test.ts`: config loading, the global flags, the logs, the install hint,
  and the delegation from a global `envi`.
- `run.test.ts`: the child environment, exit codes, and signals. It sends `SIGTERM`, `SIGINT`,
  and `SIGHUP` to the Envi process alone, and the child counts exactly one signal. On macOS, it
  also types Ctrl-C into a real pseudo terminal through `script`.
- `commands.test.ts`: `sync`, `check`, `inspect`, `export` with `--output`, and `cache`.
- `cache.test.ts`: cache hits across processes, `--refresh`, `--no-cache`, CI, the stale
  fallback, file modes, and four parallel processes on an empty cache.
- `encryption.test.ts`: the real macOS Keychain. An edited entry, a moved entry, and a plaintext
  entry in place of an encrypted entry all count as a miss. It runs on macOS only.
- `sdk.test.ts`: a custom provider, a custom `Cache` layer in one JSON file, the encrypted cache
  with a fixed key, and the plain client.

## Tests against real 1Password

- These tests live in the provider package, in `packages/onepassword/e2e/`. The fixture script is
  `packages/onepassword/scripts/fixture.ts`. The package publishes only `dist`.
- `e2e/fixture.ts` holds the fake vaults, items, and values. Every value is fake
  and public. The items are Secure Notes, and their fields are the keys.
- `bun fixture:onepassword <status|setup|teardown>` checks, creates, and deletes the fixture
  through `@1password/sdk` and desktop authentication. One run asks for one approval.
- `setup` is idempotent. `teardown` deletes a vault only when its title and its description both
  match the fixture.
- The credential comes from the environment. `ENVI_TEST_ONEPASSWORD_TOKEN` holds a service
  account token, and no run asks for an approval. `ENVI_TEST_ONEPASSWORD_ACCOUNT` holds the
  account name for desktop authentication. The token wins. Neither value appears in the
  repository. `bun run test:onepassword` skips itself without both.
- The service account needs the permission to create vaults, because 1Password cannot grant a
  service account access to a vault after its creation. The fixture script then creates the
  vaults with the token. The token lives in the ignored file `.env.local`. Bun loads that file
  for the fixture script, and `test:onepassword` passes it to Node with `--env-file-if-exists`.
- Service account token auth is verified with `@1password/sdk@0.5.0` on Node and Bun.
- `bun run verify` does not run these tests, because they need an approval from a person.
- The suite covers the plain client and the built CLI on Node and Bun. It passes on macOS.
- The test files run one after another. The 1Password app rejects simultaneous connections from
  several processes. In normal use, the resolve lock of the shared cache serializes them.
- The real SDK sets the unused member of a response, `content` or `error`, to `null`.

## Known limits

- The 1Password app rejects simultaneous desktop connections from several processes. The
  resolve lock of the shared cache serializes them. With `cache: false` and desktop
  authentication, parallel `envi` processes can fail with `Unavailable`. A service account token
  has no such limit: four parallel processes pass.
- Node reports `EACCES` in place of `ENOENT` for a missing command when a folder of `PATH` is not
  readable. `run` then fails with `CommandNotExecutable` in place of `CommandNotFound`.

## Not tested yet

- An Expo or Xcode build under `envi run`.
- `@1password/sdk` on Linux.

## After v1

- A GitHub provider for variables, and `envi push` with a target interface. The GitHub API never
  returns a secret value, so GitHub secrets can only be a push target.
- A reference address that depends on a resolved value.
