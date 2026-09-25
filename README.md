# Envi

Envi is an env manager for TypeScript projects. A project defines its env in a typed
`envi.config.ts`. Envi resolves the config once from a secret provider, caches the result, and
injects the values into a runtime. 1Password is the only provider for now.

Envi works as a CLI (`envi`) and as an SDK with a plain TypeScript API and an Effect API.

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

A signal ended the command of `envi run`.

Next action: A signal ended the command. Run the command without Envi to see whether it fails on its own.

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

Next action: Install Envi and each provider package in the project, such as `bun add -d envi`.

<a id="error-config-load-unsupported-runtime"></a>

### ConfigLoadError UnsupportedRuntime

The runtime cannot import a TypeScript config file.

Next action: Run Envi on Node 22.19.0 or later, or on Bun.

<a id="error-config-load-invalid-config"></a>

### ConfigLoadError InvalidConfig

The file is not a config: a wrong extension, a default export that is not from `defineConfig`, or a command that got several configs.

Next action: Fix the config file or the config list that the detail names.
