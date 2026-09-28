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

## Install

```sh
bun add @kynnyhsap/envi @kynnyhsap/envi-1password "effect@4.0.0-rc.118"
```

The package is `@kynnyhsap/envi`, and its command is `envi`. `effect` is a peer dependency, so the
project has one copy of it. Envi needs `effect` 4. A bare `effect` installs version 3 until version
4 becomes the `latest` tag on npm. While Effect 4 is a release candidate, Envi asks for one exact
version of `effect`, because a new release candidate can break imports. Use that version in the
project. Each Envi release moves to the newest Effect release. `@kynnyhsap/envi-1password`
installs `@1password/sdk`. A global `envi` starts the local `envi` of the project.

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

## Docs

The docs live in [`packages/docs/content`](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/README.md). The npm package ships the same pages in
its `docs` folder, so they always match the installed version.

- [Getting started](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/getting-started.md)
- Config: [keys and stages](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/config/index.md), [sources](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/config/sources.md),
  [derive and custom](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/config/derive-and-custom.md), [monorepo](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/config/monorepo.md)
- CLI: [commands and flags](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/cli/index.md), [config search](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/cli/config-search.md),
  [envi run](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/cli/run.md)
- [Settings](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/settings.md), [Cache](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/cache.md), [CI](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/ci.md)
- [1Password](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/providers/1password.md)
- SDK: [client](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/sdk/index.md), [Effect](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/sdk/effect.md),
  [custom providers and caches](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/sdk/custom-providers.md)
- [Known limits](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/known-limits.md)
- [Errors](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/errors/index.md): one page for each error

## License

[MIT](LICENSE)
