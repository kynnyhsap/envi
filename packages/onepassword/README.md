# @kynnyhsap/envi-1password

The 1Password provider of [Envi](https://github.com/kynnyhsap/envi). It resolves `op()`
references through the official `@1password/sdk`, in one batch for each run. It does not need the
`op` CLI.

## Install

```sh
bun add @kynnyhsap/envi @kynnyhsap/envi-1password "effect@4.0.0-rc.118"
```

`@kynnyhsap/envi-1password` installs `@1password/sdk`. `envi` and `effect` are peer dependencies.

## Usage

```ts
import { defineConfig } from "@kynnyhsap/envi";
import { onePasswordProvider } from "@kynnyhsap/envi-1password";

export default defineConfig({
  stages: ["development", "production"],
  providers: [onePasswordProvider({ account: "my-team" })],
  vars: ({ stage, op }) => ({
    DATABASE_URL: op(`op://app-${stage}/postgres/url`),
    STRIPE_KEY: op("payments", "stripe", "secret-key"),
  }),
});
```

`vars` receives `op` from the provider, so the config needs no import of `op`. Code outside
`vars` imports `op` from `@kynnyhsap/envi-1password`.

## Docs

The [1Password page](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/providers/1password.md) of the Envi docs describes the reference forms,
the authentication, the timeouts, and the error classification. `@kynnyhsap/envi` ships the same
page in `docs/providers/1password.md`. [Errors](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/errors/index.md) explains each error and its
next action.

## License

MIT
