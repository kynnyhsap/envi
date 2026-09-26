# Envi

Envi is an env manager for TypeScript projects. A project defines its env in a typed
`envi.config.ts`. Envi resolves the config once from a secret provider, caches the result, and
injects the values into a runtime. 1Password is the only provider for now.

Envi works as a CLI (`envi`) and as an SDK with a plain TypeScript API and an Effect API.

- Envi resolves secrets once and serves the next runs from an encrypted cache. A dev script does
  not wait for the secret provider on every start.
- The config is typed TypeScript, not a text file such as `.env.example`. Application code uses
  the config and its schemas as types.
- The CLI and the SDK work on a developer machine, in CI, and for a coding agent.

Envi runs on Node 22.19.0 or later and on Bun 1.3.0 or later, on macOS and Linux. Windows is not supported.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Config](#config)
- [CLI](#cli)
- [Settings](#settings)
- [Cache](#cache)
- [1Password](#1password)
- [CI](#ci)
- [SDK](#sdk)
- [Known limits](#known-limits)
- [Errors](#errors)
- [License](#license)

## Install

```sh
bun add @kynnyhsap/envi @kynnyhsap/envi-1password "effect@^4.0.0-rc.117"
```

The package is `@kynnyhsap/envi`, and its command is `envi`. `effect` is a peer dependency, so the
project has one copy of it. Envi needs `effect` 4. A bare `effect` installs version 3 until version
4 becomes the `latest` tag on npm. `@kynnyhsap/envi-1password` installs `@1password/sdk`. A global
`envi` starts the local `envi` of the project.

## Quick start

Create `envi.config.ts` at the root of the project:

```ts
import * as Schema from "effect/Schema";
import { defineConfig } from "@kynnyhsap/envi";
import { onePasswordProvider } from "@kynnyhsap/envi-1password";

export default defineConfig({
  stages: ["development", "production"],
  providers: [onePasswordProvider({ account: "my-team" })],
  vars: ({ stage, op, value }) => ({
    PORT: value("3000").schema(Schema.FiniteFromString),
    DATABASE_URL: op(`op://app-${stage}/postgres/url`),
    STRIPE_KEY: op("payments", "stripe", "secret-key"),
  }),
});
```

Run a command with the vars:

```sh
envi run -- bun dev
```

The first run resolves every secret in one batch and fills the cache. The next runs read the
cache. `envi check` validates every var and shows no value.

## Config

`defineConfig` takes one object. Every key is optional.

| Key            | Holds                                                                                 |
| -------------- | ------------------------------------------------------------------------------------- |
| `stages`       | The names of the stages. `stage` gets a union type, and Envi rejects any other stage. |
| `defaultStage` | The stage without `--stage` and `ENVI_STAGE`. Default: `development`.                 |
| `providers`    | The provider instances, such as `onePasswordProvider()`.                              |
| `cache`        | `false`, or `{ ttl, maxStale, directory, encryption }`. See [Cache](#cache).          |
| `strict`       | `true` never uses an expired cache entry.                                             |
| `vars`         | A plain object, or a synchronous function of the stage.                               |

`vars` returns only literals and descriptors. It never resolves a secret and does no I/O, so
`check`, `parse`, and `schemaOf` read a config without a provider call. The function receives the
stage, the built-in helpers, and the helpers of each provider, such as `op`. A config file then
needs no helper import.

A stage is a named set of env values. Envi selects the stage in this order: `--stage`,
`ENVI_STAGE`, `defaultStage`, `development`. `NODE_ENV` never selects the stage. `envi run` passes
`ENVI_STAGE` to the child.

### Sources

| Helper                    | Value                                                                           |
| ------------------------- | ------------------------------------------------------------------------------- |
| a string                  | A literal. It never enters the cache.                                           |
| `value(text)`             | A literal with the descriptor methods, such as `.schema()`.                     |
| `fromEnv(name)`           | A variable of the Envi process, such as a CI secret. It never enters the cache. |
| `op(...)`                 | A 1Password secret. See [1Password](#1password).                                |
| `reference(id, ref)`      | A reference for the provider with the id `id`. A custom provider uses it.       |
| `derive(input, fn)`       | A pure synchronous function of other descriptors. Envi never caches it.         |
| `custom({ id, resolve })` | Effectful user code, such as a token exchange. Envi caches it.                  |

### Descriptor methods

Each method returns a new descriptor.

- `.schema(schema)` decodes the raw string with an Effect `Schema` that encodes to a string, such
  as `Schema.FiniteFromString`, `Schema.URLFromString`, or `BooleanFromString` from `envi`.
  Without a schema, the value is a `string`.
- `.optional()` gives `undefined` when the provider reports `NotFound`.
- `.default(raw)` gives a raw string when the provider reports `NotFound`. The default passes
  through the schema. Every other failure stays a failure.
- `.redact(false)` shows the value in `inspect` and in a redacted export. Secrets are redacted by
  default.
- `.cache(false)` resolves the value on every run. `.cache({ ttl, maxStale })` overrides the cache
  settings for one value.

### derive and custom

Both take their inputs as descriptors. Envi resolves every reference in one batch for each
provider, and then evaluates each value from the inside to the outside. An input does not have to
be a var: `envi run` injects only the vars. Both return a raw string or `undefined`, and
`undefined` counts as `NotFound`.

```ts
vars: ({ op, derive, custom }) => ({
  // A pure function. Envi calls it on every run.
  REPLICA_URL: derive(
    { user: op("app", "replica", "user"), password: op("app", "replica", "password") },
    ({ user, password }) => `postgres://${user}:${password}@replica/app`,
  ),
  // Effectful code. `resolve` returns a string, `undefined`, a `Promise`, or an `Effect`.
  API_TOKEN: custom({
    id: "api-token",
    from: { clientSecret: op("app", "oauth", "client-secret") },
    resolve: ({ clientSecret }) => exchangeToken(clientSecret),
  }).cache({ ttl: "50 minutes" }),
}),
```

- `id` names a `custom()` value in the cache and in errors. `scope` names everything outside the
  inputs that selects the value, such as a host.
- Envi keeps one entry for each `id`, stage, and `scope`. The entry holds a digest of the code of
  `resolve` and of the input values. A changed input or a changed `resolve` computes a new value.
- A throw shows only the class name and the location, never the message, because a message can
  hold a secret. A `CustomFailure({ message, transient })` shows its message. `transient: true`
  allows an expired entry of the same inputs.

### Monorepo

Each package that needs env has its own `envi.config.ts`. Packages share pieces through a plain
TypeScript module, such as `envi.shared.ts` at the repo root. Run `envi sync` once at the root,
and then `envi run` in each package.

A config file on Node has the limits of type stripping: no enums, no namespaces, no parameter
properties, explicit `.ts` extensions in relative imports, no tsconfig `paths`, and ESM only.

## CLI

| Command             | Does                                                                |
| ------------------- | ------------------------------------------------------------------- |
| `envi run -- <cmd>` | Runs a command with the resolved vars.                              |
| `envi sync`         | Resolves every var of every config in the repo and fills the cache. |
| `envi check`        | Resolves and validates every var. Shows no value.                   |
| `envi inspect`      | Shows where each var comes from. Hides secrets by default.          |
| `envi export`       | Prints the vars as dotenv or JSON, or writes them to a file.        |
| `envi cache path`   | Prints the cache directory.                                         |
| `envi cache list`   | Lists the cache entries. Shows no value.                            |
| `envi cache clear`  | Removes every cache entry.                                          |

A flag follows its command: `envi check --stage production`.

| Flag                                | Commands                          | Does                                                        |
| ----------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| `--config <file>`                   | run, sync, check, inspect, export | Selects a config file. Repeat it for several files.         |
| `--config-search <direction>`       | run, sync, check, inspect, export | `up`, `down`, or `repo`. See below.                         |
| `--stage <name>`                    | run, sync, check, inspect, export | Selects the stage.                                          |
| `--refresh`                         | run, sync, check, inspect, export | Ignores fresh cache entries.                                |
| `--strict`                          | run, sync, check, inspect, export | Never uses an expired cache entry.                          |
| `--interactive`, `--no-interactive` | run, sync, check, inspect, export | Allows or forbids a prompt, such as a desktop app approval. |
| `--cache`, `--no-cache`             | run, sync, check, inspect, export | Turns the cache on or off.                                  |
| `--cache-dir <dir>`                 | every command except `--version`  | Selects the cache directory.                                |
| `--json`                            | every command except run          | Prints the report, or the error, as JSON on stdout.         |
| `--redact`, `--no-redact`           | inspect, export                   | Hides or shows the secret values.                           |
| `--format dotenv\|json`             | export                            | Selects the output format.                                  |
| `--output <file>`                   | export                            | Writes a file with the mode `0600`.                         |
| `--debug`                           | every command                     | Shows debug logs, with the duration of each step.           |
| `--log-format pretty\|json`         | every command                     | Selects the format of the logs on stderr.                   |

All logs go to stderr, so stdout stays clean for `export` and `--json`. A log never holds a secret
value.

### Config search

Without `--config` and `ENVI_CONFIG`, Envi searches for `envi.config.ts`, `.mts`, `.js`, or `.mjs`.
The project root is the nearest folder with `.git`.

- `up`: the nearest config in the working directory or an ancestor, up to the project root. Outside
  a repo, the search stops at the home folder. `run`, `check`, `inspect`, and `export` search `up`.
- `down`: every config in the working directory and below it. In a repo, git decides which files
  count, so an ignored folder is left out. Outside a repo, Envi skips `node_modules` and dot
  folders.
- `repo`: every config of the project, from the project root down. `sync` searches `repo`.

A command that uses one config fails with [`ManyConfigs`](#error-config-load-many-configs) when the
search or the flags give several.

### envi run

- The child gets the environment of Envi plus the resolved vars. A resolved var wins.
- Envi removes the credential variables of each provider from the child, such as
  `OP_SERVICE_ACCOUNT_TOKEN`, and every `ENVI_PROVIDER_*` variable.
- Envi resolves and validates every var before it starts the child. A failure starts no child.
- Envi forwards `SIGTERM` and `SIGHUP` to the child, and `SIGINT` when no terminal is attached. A
  terminal sends `SIGINT` to the child on its own. Envi exits with the exit code of the child.
- When `SIGHUP`, `SIGINT`, or `SIGTERM` ends the child, Envi exits with 128 plus the number of the
  signal, as a shell does: 129, 130, or 143. Ctrl-C gives 130. Another signal gives
  `RunError KilledBySignal`.
- The arguments after `--` belong to the child. `envi run -- node app.js --json` passes `--json` to
  the child.

## Settings

Every setting follows one order: a CLI flag or a call option, a client option, an environment
variable, a config key, a default.

| Variable                                          | Setting                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `ENVI_STAGE`                                      | The stage.                                                       |
| `ENVI_CONFIG`                                     | A comma-separated list of config files.                          |
| `ENVI_CONFIG_SEARCH`                              | `up`, `down`, or `repo`.                                         |
| `ENVI_STRICT`                                     | `true` never uses an expired cache entry.                        |
| `ENVI_INTERACTIVE`                                | `true` or `false`. Default: `false` in CI, `true` elsewhere.     |
| `ENVI_CACHE_ENABLED`                              | `true` or `false`. Default: `false` in CI, `true` elsewhere.     |
| `ENVI_CACHE_DIR`                                  | The cache directory. Default: `~/.cache/envi`.                   |
| `ENVI_CACHE_KEY`                                  | The key of the encrypted cache, for a system without a keychain. |
| `CI`                                              | Any value except empty, `false`, and `0` means CI.               |
| `ENVI_PROVIDER_ONEPASSWORD_ACCOUNT`               | The 1Password account.                                           |
| `ENVI_PROVIDER_ONEPASSWORD_SERVICE_ACCOUNT_TOKEN` | A 1Password service account token.                               |
| `OP_SERVICE_ACCOUNT_TOKEN`                        | A 1Password service account token, with a lower priority.        |

## Cache

The cache holds one entry for each secret, in `~/.cache/envi` by default. Parallel worktrees share
the entries. `--cache-dir`, `ENVI_CACHE_DIR`, or `cache.directory` selects another directory.

- An entry expires after `ttl`, 24 hours by default. When the refresh of an expired entry fails
  because the provider is unavailable, Envi uses the expired value up to `maxStale`, 7 days by
  default, and logs a warning. `NotFound`, `AccessDenied`, and `Invalid` never allow the expired
  value. `--strict` and CI turn the fallback off.
- Envi encrypts each entry with AES-256-GCM. The key comes from `ENVI_CACHE_KEY`, or from the
  keychain: the macOS Keychain, or the Secret Service on Linux through `secret-tool`, such as GNOME
  Keyring. Envi creates the key on the first use.
- Without a key, Envi logs one warning and runs without a cache. With `--cache` or
  `ENVI_CACHE_ENABLED=true`, a missing key fails with
  [`KeyUnavailable`](#error-cache-key-unavailable).
- Envi never falls back from encryption to plaintext. `encryption: "none"` writes plaintext files
  with the mode `0600`, as an explicit opt-in.
- A lock serializes the resolution of several processes on an empty cache, so a provider gets one
  call. Envi recovers the lock of a crashed process.
- The cache serves the trust level of a `.env` file. Any process of the OS user can use it, a coding
  agent too. The encryption protects the files against file reads, searches, and backups.
- The cache is off in CI by default. `cache path`, `cache list`, and `cache clear` always use the
  cache directory, also in CI.

## 1Password

`@kynnyhsap/envi-1password` is the 1Password provider. It gives `vars` the helper `op()`:

```ts
op("op://app/postgres/url");
op("app", "postgres", "url"); // vault, item, field
```

A token in `OP_SERVICE_ACCOUNT_TOKEN` selects a service account. Without a token, the provider
asks the 1Password app for an approval. The
[provider README](https://github.com/kynnyhsap/envi/tree/main/packages/onepassword#readme) describes the reference forms, the
authentication, the timeouts, and the error classification.

## CI

- Set a service account token, such as `OP_SERVICE_ACCOUNT_TOKEN`. CI runs are not interactive,
  so the 1Password provider fails at once without a token.
- The cache is off, and every run is strict. `envi sync` says that the cache is off.
- To keep a cache between jobs, set `ENVI_CACHE_KEY` from a CI secret and `--cache` or
  `ENVI_CACHE_ENABLED=true`, and cache the directory of `ENVI_CACHE_DIR`.

## SDK

Every operation comes from a client of one config. The client mirrors the CLI.

```ts
import { createEnvi } from "@kynnyhsap/envi";
import config from "./envi.config.ts";

const envi = createEnvi(config);

const env = await envi.load({ stage: "production" }); // typed values
const raw = await envi.loadRaw(); // raw strings
const parsed = await envi.parse(process.env); // decodes existing strings, resolves nothing
const key = await envi.resolve(op("payments", "stripe", "secret-key")); // one secret
```

The client also has `run`, `sync`, `check`, `inspect`, `export`, and `cache.path`, `cache.list`,
and `cache.clear`. Each returns the report that `--json` prints. `syncAll(clients)` syncs several
clients with one call for each shared provider. `createEnvi(config, overrides)` takes
`providers`, `cache`, `strict`, and `interactive`, which win over the config.

- Envi never changes `process.env`. The caller assigns the result of `loadRaw`.
- `Env<typeof config>`, `RawEnv<typeof config>`, and `StageOf<typeof config>` are the types of a
  config. `schemaOf(config, stage)` returns its `Schema`.
- A method rejects with a tagged error. Each error has `summary`, `hint`, and `docs`.

### Effect

Every operation is an Effect on the `Envi` service. The plain client runs these Effects.

```ts
import * as Effect from "effect/Effect";
import { Envi, layer } from "@kynnyhsap/envi";

const program = Effect.gen(function* () {
  const envi = yield* Envi.Envi;

  return yield* envi.load(config, { stage: "production" });
});

program.pipe(Effect.provide(layer({ strict: true })));
```

`layer(options)` provides the default cache, the environment and the signals of the process, and
the platform services of Node or Bun.

### Custom providers and caches

`Provider.make({ id, Reference, describe, scope, resolveMany, helpers })` builds a provider.
`resolveMany` resolves a whole batch in one call. `reference(id, ref)` builds a descriptor for it.
A custom cache is a layer of the `Cache.Cache` service. Both interfaces are public and unstable
until a second real provider proves them. `examples/sdk-custom-provider.ts` shows a provider.

`@kynnyhsap/envi/testing` exports `memoryProvider` and `mem` for tests.

## Known limits

- The 1Password app rejects parallel desktop connections from several processes. The resolve lock
  of the cache serializes them. With the cache off and desktop authentication, parallel `envi`
  processes can fail with `Unavailable`. A service account token has no such limit.
- If a folder of `PATH` is not readable, Node reports `EACCES` for a missing command. `envi run`
  then fails with `CommandNotExecutable` in place of `CommandNotFound`.

## Errors

Every Envi error has a summary, a hint, and a docs link to its section below. The summary says what
failed. The hint names the next action. No error holds a secret value.

The CLI prints an error on stderr and exits with the code 1. With `--json`, the CLI prints the error
as one JSON document on stdout:

```json
{
  "error": {
    "error": "VarsError",
    "reason": null,
    "summary": "Envi failed to resolve 1 var of the stage development in /repo/apps/api/envi.config.ts: TOKEN",
    "hint": "Fix each failed var. Each failure has its own hint. `envi check` lists all failures.",
    "docs": "https://github.com/kynnyhsap/envi#error-vars",
    "failures": [
      {
        "key": "TOKEN",
        "config": "/repo/apps/api/envi.config.ts",
        "reference": "op://app/api/token",
        "error": "SecretReferenceError",
        "reason": "NotFound",
        "summary": "Envi reference failed: NotFound for op://app/api/token (provider onepassword)",
        "hint": "Check that the reference names an existing secret, and that the credential can see it.",
        "docs": "https://github.com/kynnyhsap/envi#error-secret-reference-not-found"
      }
    ]
  }
}
```

The SDK fails with the same tagged errors. Each error has the getters `summary`, `hint`, and `docs`.

<a id="error-secret-reference-not-found"></a>

### SecretReferenceError NotFound

The provider has no secret at the reference, or the credential cannot see it.

Next action: Check that the reference names an existing secret, and that the credential can see it. If the var may be missing, add `.optional()` or `.default(value)`.

<a id="error-secret-reference-invalid"></a>

### SecretReferenceError Invalid

The reference does not match the format of the provider.

Next action: Fix the reference so that it matches the format of the provider. Run `envi inspect` to see each reference.

<a id="error-secret-reference-access-denied"></a>

### SecretReferenceError AccessDenied

The credential exists, but it has no access to the secret.

Next action: Give the credential access to the secret, or use a credential that has access.

<a id="error-provider-authentication-failed"></a>

### ProviderError AuthenticationFailed

The provider rejected the credential, or no credential exists.

Next action: Sign in to the provider, or set a valid credential. The detail names what the provider needs.

<a id="error-provider-unavailable"></a>

### ProviderError Unavailable

The provider did not answer: a network failure, a timeout, or an outage.

Next action: Check the network and the provider, then run the command again. Without `--strict` and outside CI, Envi uses an expired cache entry up to `maxStale`.

<a id="error-provider-misconfigured"></a>

### ProviderError Misconfigured

A setting of the provider is wrong or missing.

Next action: Fix the provider setting that the detail names.

<a id="error-provider-unknown-provider"></a>

### ProviderError UnknownProvider

A descriptor names a provider that is not in `providers` of the config.

Next action: Add the provider to `providers` in the config, or fix the provider id of the descriptor.

<a id="error-provider-invalid-response"></a>

### ProviderError InvalidResponse

The provider answered with data that Envi cannot read.

Next action: The provider returned a malformed answer. Update the provider package, or report the problem to its author.

<a id="error-decode"></a>

### DecodeError

The raw value does not match the schema of the var. The error names what the schema expects. It never shows the value.

Next action: Change the value in the provider so that it matches the schema, or change the schema of the var.

<a id="error-custom-threw"></a>

### CustomError Threw

The `resolve` function of a `custom()` var threw. Envi shows the class name and the location of the throw, never the message.

Next action: Fix the code of `resolve` at the location. To show a safe cause, fail with `new CustomFailure({ message })`.

<a id="error-custom-failed"></a>

### CustomError Failed

The `resolve` function of a `custom()` var failed with a `CustomFailure`. Envi shows its message.

Next action: Fix the cause that the message names. Pass `transient: true` to allow an expired cache entry during an outage.

<a id="error-derive"></a>

### DeriveError

The function of a `derive()` var threw. Envi shows the class name and the location of the throw, never the message.

Next action: Fix the `derive()` function at the location. Return `undefined` for a missing value instead of a throw.

<a id="error-vars"></a>

### VarsError

One or more vars failed. The error lists every failed var with its own error, hint, and docs link.

Next action: Fix each failed var. Each failure has its own hint. `envi check` lists all failures.

<a id="error-unknown-stage"></a>

### UnknownStageError

The selected stage is not in the `stages` list of the config.

Next action: Pass a declared stage with `--stage` or `ENVI_STAGE`, or add the stage to `stages` in the config.

<a id="error-cache-unreadable"></a>

### CacheError Unreadable

Envi cannot read or decrypt a cache file.

Next action: Check the permissions of the cache directory, or remove the entries with `envi cache clear`.

<a id="error-cache-unwritable"></a>

### CacheError Unwritable

Envi cannot write a cache file.

Next action: Check that the cache directory is writable, or select another one with `--cache-dir` or `ENVI_CACHE_DIR`.

<a id="error-cache-key-unavailable"></a>

### CacheError KeyUnavailable

Envi has no encryption key for the cache: `ENVI_CACHE_KEY` is not set, and the OS keychain gives no key. Without `--cache` or `ENVI_CACHE_ENABLED`, Envi warns once and runs without a cache.

Next action: Set ENVI_CACHE_KEY, or allow Envi to use the OS keychain (on Linux, install `secret-tool`), or turn the cache off with `--no-cache`.

<a id="error-cache-lock-timeout"></a>

### CacheError LockTimeout

Envi waited too long for the lock of the cache directory.

Next action: Another Envi process holds the cache lock. Wait for it to finish, then run the command again.

<a id="error-export"></a>

### ExportError

A value holds characters that the dotenv format cannot quote safely.

Next action: Export with `--format json`, or remove the characters that dotenv cannot quote from the value.

<a id="error-export-file-write-failed"></a>

### ExportFileError WriteFailed

Envi cannot write the output file of `envi export --output`.

Next action: Check that the folder of the file exists and is writable.

<a id="error-settings"></a>

### SettingsError

An `ENVI_*` environment variable holds a value that Envi cannot parse.

Next action: Fix the value of the environment variable, or unset it.

<a id="error-run-command-not-found"></a>

### RunError CommandNotFound

The command of `envi run` does not exist on `PATH`.

Next action: Check the command name and `PATH`. Put `--` before the command: `envi run -- bun dev`.

<a id="error-run-command-not-executable"></a>

### RunError CommandNotExecutable

The command of `envi run` exists, but the OS does not allow Envi to run it.

Next action: Make the file executable with `chmod +x`, or check the permissions of the folders on `PATH`.

<a id="error-run-spawn-failed"></a>

### RunError SpawnFailed

The OS failed to start the command of `envi run`.

Next action: Check the command, its arguments, and the working directory.

<a id="error-run-killed-by-signal"></a>

### RunError KilledBySignal

A signal other than `SIGHUP`, `SIGINT`, or `SIGTERM` ended the command of `envi run`.

Next action: A signal such as `SIGKILL` or `SIGSEGV` ended the command. Run the command without Envi to see whether it fails on its own.

<a id="error-config-load-not-found"></a>

### ConfigLoadError NotFound

An explicit config path does not exist.

Next action: Check the path in `--config` or `ENVI_CONFIG`.

<a id="error-config-load-no-config"></a>

### ConfigLoadError NoConfig

The config search found no config file. `up` looks in the working directory and its ancestors up to the project root, or up to the home folder outside a repo. `down` and `repo` look below a folder.

Next action: Create `envi.config.ts` in the project, pass `--config <file>`, or search in another direction with `--config-search`.

<a id="error-config-load-many-configs"></a>

### ConfigLoadError ManyConfigs

`run`, `check`, `inspect`, and `export` use one config. The search or the flags gave several.

Next action: Pass one `--config <file>`, or run the command in the folder of one config with `--config-search up`.

<a id="error-config-load-import-failed"></a>

### ConfigLoadError ImportFailed

The config file threw while Envi imported it. Envi shows the class name and the location of the throw, never the message.

Next action: Run the config file on its own to see the error, such as `bun envi.config.ts`.

<a id="error-config-load-config-syntax"></a>

### ConfigLoadError ConfigSyntax

The config file has a syntax error. Envi shows the location, never the source text.

Next action: Fix the syntax error at the location. Run the config file on its own to see the parser message.

<a id="error-config-load-vars-threw"></a>

### ConfigLoadError VarsThrew

The `vars` function of the config threw for a stage.

Next action: Fix `vars` at the location. `vars` returns literals and descriptors, and it must not throw.

<a id="error-config-load-missing-dependency"></a>

### ConfigLoadError MissingDependency

The config imports a package that does not resolve from the project.

Next action: Install Envi and each provider package in the project, such as `bun add -d @kynnyhsap/envi`.

<a id="error-config-load-unsupported-runtime"></a>

### ConfigLoadError UnsupportedRuntime

The runtime cannot import a TypeScript config file.

Next action: Run Envi on Node 22.19.0 or later, or on Bun 1.3.0 or later.

<a id="error-config-load-invalid-config"></a>

### ConfigLoadError InvalidConfig

The file is not a config: a wrong extension, or a default export that is not from `defineConfig`.

Next action: Fix the config file or the config list that the detail names.

## License

[MIT](LICENSE)
