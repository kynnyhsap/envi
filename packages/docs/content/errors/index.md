---
title: "Errors"
description: "How an Envi error looks, and one page for each error."
---

# Errors

Every Envi error has a summary, a hint, and a docs link to its page. The summary says what
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
    "docs": "https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/errors/vars.md",
    "failures": [
      {
        "key": "TOKEN",
        "config": "/repo/apps/api/envi.config.ts",
        "reference": "op://app/api/token",
        "error": "SecretReferenceError",
        "reason": "NotFound",
        "summary": "Envi reference failed: NotFound for op://app/api/token (provider onepassword)",
        "hint": "Check that the reference names an existing secret, and that the credential can see it. Run `envi find <name>` to list the references of a close name. If the var may be missing, add `.optional()` or `.default(value)`.",
        "docs": "https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/errors/secret-reference-not-found.md"
      }
    ]
  }
}
```

To read the page of an error offline, pass its docs link to `envi docs show`. The command prints
the page of the installed version.

The SDK fails with the same tagged errors. Each error has the getters `summary`, `hint`, and `docs`.

## Every error

| Error                                                                      | Summary                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [SecretReferenceError NotFound](./secret-reference-not-found.md)           | The provider has no secret at the reference, or the credential cannot see it.         |
| [SecretReferenceError Invalid](./secret-reference-invalid.md)              | The reference does not match the format of the provider.                              |
| [SecretReferenceError AccessDenied](./secret-reference-access-denied.md)   | The credential exists, but it has no access to the secret.                            |
| [ProviderError AuthenticationFailed](./provider-authentication-failed.md)  | The provider rejected the credential, or no credential exists.                        |
| [ProviderError Unavailable](./provider-unavailable.md)                     | The provider did not answer.                                                          |
| [ProviderError Misconfigured](./provider-misconfigured.md)                 | A setting of the provider is wrong or missing.                                        |
| [ProviderError UnknownProvider](./provider-unknown-provider.md)            | A descriptor names a provider that is not in `providers` of the config.               |
| [ProviderError InvalidResponse](./provider-invalid-response.md)            | The provider answered with data that Envi cannot read.                                |
| [DecodeError](./decode.md)                                                 | The raw value does not match the schema of the var.                                   |
| [CustomError Threw](./custom-threw.md)                                     | The `resolve` function of a `custom()` var threw.                                     |
| [CustomError Failed](./custom-failed.md)                                   | The `resolve` function of a `custom()` var failed with a `CustomFailure`.             |
| [DeriveError](./derive.md)                                                 | The function of a `derive()` var threw.                                               |
| [VarsError](./vars.md)                                                     | One or more vars failed.                                                              |
| [UnknownStageError](./unknown-stage.md)                                    | The selected stage is not in the `stages` list of the config.                         |
| [CacheError Unreadable](./cache-unreadable.md)                             | Envi cannot read or decrypt a cache file.                                             |
| [CacheError Unwritable](./cache-unwritable.md)                             | Envi cannot write a cache file.                                                       |
| [CacheError KeyUnavailable](./cache-key-unavailable.md)                    | Envi has no encryption key for the cache.                                             |
| [CacheError LockTimeout](./cache-lock-timeout.md)                          | Envi waited too long for the lock of the cache directory.                             |
| [ExportError](./export.md)                                                 | A value holds characters that the dotenv format cannot quote safely.                  |
| [ExportFileError WriteFailed](./export-file-write-failed.md)               | Envi cannot write the output file of `envi export --output`.                          |
| [SettingsError](./settings.md)                                             | A setting holds a value that Envi cannot read, or the configs of a sync disagree.     |
| [RunError CommandNotFound](./run-command-not-found.md)                     | The command of `envi run` does not exist on `PATH`.                                   |
| [RunError CommandNotExecutable](./run-command-not-executable.md)           | The command of `envi run` exists, but the OS does not allow Envi to run it.           |
| [RunError SpawnFailed](./run-spawn-failed.md)                              | The OS failed to start the command of `envi run`.                                     |
| [RunError KilledBySignal](./run-killed-by-signal.md)                       | A signal other than `SIGHUP`, `SIGINT`, or `SIGTERM` ended the command of `envi run`. |
| [DocsError NotFound](./docs-not-found.md)                                  | `envi docs show` or `envi docs path` got a name that no docs page has.                |
| [DocsError Unreadable](./docs-unreadable.md)                               | Envi cannot read its docs folder, or a page has no valid frontmatter.                 |
| [ConfigLoadError NotFound](./config-load-not-found.md)                     | An explicit config path does not exist.                                               |
| [ConfigLoadError NoConfig](./config-load-no-config.md)                     | The config search found no config file.                                               |
| [ConfigLoadError ManyConfigs](./config-load-many-configs.md)               | `run`, `check`, `inspect`, and `export` use one config.                               |
| [ConfigLoadError ImportFailed](./config-load-import-failed.md)             | The config file threw while Envi imported it.                                         |
| [ConfigLoadError ConfigSyntax](./config-load-config-syntax.md)             | The config file has a syntax error.                                                   |
| [ConfigLoadError VarsThrew](./config-load-vars-threw.md)                   | The `vars` function of the config threw for a stage.                                  |
| [ConfigLoadError MissingDependency](./config-load-missing-dependency.md)   | The config imports a package that does not resolve from the project.                  |
| [ConfigLoadError UnsupportedRuntime](./config-load-unsupported-runtime.md) | The runtime cannot import a TypeScript config file.                                   |
| [ConfigLoadError InvalidConfig](./config-load-invalid-config.md)           | The file is not a config.                                                             |
