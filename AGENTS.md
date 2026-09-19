# Envi

Envi is an env manager for TypeScript projects. It resolves env values from 1Password. 1Password
is the only provider for now. The architecture stays provider agnostic so that more providers can
follow. `envi` is the name of the CLI. The npm package name is not decided, so code must not depend
on the package name.

## Idea

A project defines its env in a typed TypeScript config file. Envi resolves the config once, caches
the result, and injects the values into a runtime.

Reasons:

- Resolving secrets on every dev script run is slow and wasteful.
- Text env files such as `.env.example` are unsafe and untyped.

## Use cases

Every design decision must serve at least one of these use cases.

1. A user copies a monorepo to a new worktree. The user sets up env once, from the provider or from
   the cache, and then runs the whole stack.
2. A user refreshes env on demand. Envi also refreshes env automatically after the cache expires.
3. A program loads env through the SDK.
4. A program resolves one secret through the SDK.
5. Application code uses the config and its schemas as types.
6. The CLI and the SDK work in CI, not only on a local machine.

## Trust model

The cache serves the same trust level as a `.env` file. Any process of the OS user, including a
coding agent, can use it. This is by design. A cache hit does not contact the provider, because a
cache entry proves that the user had access when Envi wrote it. Encryption protects the cache
files against file reads, searches, and backups. It does not separate processes of one OS user.
Do not add features, warnings, or special cases that try to isolate agents or stages from the
cache.

## Config file

The config file is `envi.config.ts`. `defineConfig` takes one object.

```ts
import * as Schema from "effect/Schema";
import { defineConfig } from "envi";
import { onePasswordProvider } from "envi/1password";

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
- `custom({ key, resolve })` takes a value from user code. It belongs to the built-in provider with
  the id `custom`. `resolve` runs in the batch, not in `vars`. With a `key`, Envi caches the value
  under that key. Without a `key`, Envi never caches it.
- `fromEnv(name)` takes a value from the environment of the Envi process, such as a CI secret. Envi
  never caches it. A missing variable counts as `NotFound`.
- Envi keeps the raw string next to the decoded value. It never rebuilds a raw string from a
  decoded value.
- A way to define a derived value, such as a URL built from a username and a password, is not
  decided yet. Decide this last.
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
  `>=22.18.0`. If the import fails with `ERR_UNKNOWN_FILE_EXTENSION`, Envi reports the required
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
  `envi export` writes to stdout by default. It refuses to write a file that git does not ignore.

`envi run` rules:

- The child gets the parent environment plus the resolved vars. A resolved var wins over an
  inherited var.
- Envi removes `OP_SERVICE_ACCOUNT_TOKEN` and every `ENVI_PROVIDER_*` variable from the child.
- Envi resolves and validates all vars before it starts the child. A failure starts no child.
- Envi forwards signals to the child and returns the exit code of the child.

## Providers

- The core never imports a provider. A provider package exports a descriptor helper, such as
  `op()`, and a provider factory, such as `onePasswordProvider(settings)`.
- A provider has five required members: `id`, `Reference`, `describe`, `cacheKey`, and
  `resolveMany`. The optional `helpers` member holds the descriptor helpers that `vars` receives.
  Users can write a custom provider with `defineProvider` or `Provider.make`, and a descriptor
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
- Unit tests use the in-memory provider. A separate test suite runs against real 1Password.

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
  owner.
- The cache is off by default when `CI=true`. `--cache` or `ENVI_CACHE_ENABLED=true` turns it on.
- Supported platforms: macOS and Linux. Windows is not supported in v1. On Linux, the cache is off
  by default until a keychain layer exists.

## Errors and logs

- Every error is a tagged error with a reason code. An error never holds a secret value or a
  rejected input. It holds the var key or the `describe()` text.
- The CLI logs through the Effect structured logger. All logs go to stderr, so stdout stays clean
  for `export`. `--debug` shows debug logs, including provider and schema messages. `--log-format`
  selects `pretty` or `json`.
- Every setting follows one precedence order: CLI flag or call option, client option, environment
  variable, config key, default.

## Code rules

- All source code uses Effect v4. The plain TypeScript API is a thin wrapper over the Effect API.
  It serves projects that do not use Effect.
- Design data first. Define each data structure as an Effect `Schema`. Derive every type from its
  schema. Do not write a type by hand when a schema can produce it.
- Do not use magic strings. Define each closed set of values once, as a constant object plus a
  `Schema`, such as `ExportFormat.Dotenv`. Code refers to the constant.
- Prefer a small set of strong primitives. Keep behavior explicit and known. Do not add a custom
  helper when plain TypeScript or a built-in Effect function does the job.
- Do what is simple. Do not add a special case without a real use case.
- All code runs on both Node and Bun. The core depends only on Effect platform services, such as
  `FileSystem`, `Path`, and `ChildProcessSpawner`. The core never calls `Bun.*` or `node:` APIs.
- The entry point provides the platform layer for the active runtime: `@effect/platform-bun` on
  Bun and `@effect/platform-node` on Node. Runtime-specific APIs live only in these layers.
- Test on both runtimes.
- A named set of env values is a **stage**, such as `development` or `production`. Use the word
  "stage" in code, flags (`--stage`), and docs. Do not use "env" or "environment" for this concept.
- Run `bun run verify` before you report work as done.

## API design

`design/api/` holds the public API as type-only declarations. `design/examples/` holds config and
SDK examples with compile-time type assertions. `bun typecheck` checks both. Change the declarations and the examples first when the API
design changes. Remove a declaration file when its real implementation exists in `src`.

## After v1

- A GitHub provider for variables, and `envi push` with a target interface. The GitHub API never
  returns a secret value, so GitHub secrets can only be a push target.
- The mechanism for a derived value.

## Not tested yet

- An Expo or Xcode build under `envi run`.

- Service account token auth with `@1password/sdk`.
- `@1password/sdk` on Linux.

## Commands

- `bun dev <args>` runs the CLI from source on Bun. `bun dev:node <args>` runs it on Node.
- `bun run build` bundles `dist/envi.js`.
- `bun run verify` runs format check, lint, typecheck, unit tests, and end-to-end tests.
- Use `bun run build` and `bun run test`. Bare `bun build` and `bun test` start Bun built-ins.
