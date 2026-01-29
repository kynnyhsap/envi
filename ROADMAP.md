# Roadmap

## Pending

### `update` command

Add `envi update` to self-update the CLI binary. Should check the latest release, download the correct platform binary, and replace itself.

### `install.sh` script

Create a cross-platform install script (like Bun's) that detects OS/arch and downloads the correct pre-built binary. Should support:

- macOS (x86_64, arm64)
- Linux (x86_64, aarch64)
- Optional install directory override

### Compile to single executable

Use [Bun single-file executables](https://bun.sh/docs/bundler/executables) to compile envi into a standalone binary per platform. Create a `scripts/build.ts` that runs `bun build --compile` for each target.

### `--no-masking` flag for `run` command

Add a `--no-masking` option to `envi run` that disables secret masking in subprocess output. 1Password's `op run` masks injected secrets in stdout/stderr by default and provides `--no-masking` to disable it. Envi should support the same behavior — mask by default, opt out with `--no-masking`.

See: https://developer.1password.com/docs/cli/reference/commands/run

### Multiple config file formats

Rename default config from `envi.json` to `envi.config.json` and add support for `envi.config.toml`, `envi.config.yaml` / `envi.config.yml`, `envi.config.js`, and `envi.config.ts`. All formats map to the same JSON config shape. Auto-detect by file extension when using `--config`, or discover in priority order when no explicit path is given.

### `setup` command

**Status: Needs design.** Interactive command that bootstraps secrets in the provider from a template file. Parses `.env.example` (or a user-specified file), detects all secret references, and creates the corresponding vaults/items/fields in the configured provider.

- Interactive by default — prompts for values, vault selection, etc.
- Non-interactive mode with `-f` flag for CI/scripting
- Open question: how to handle secrets that already exist in the provider (skip, overwrite, prompt?)
- Open question: should it also generate `envi.config.json` as part of setup?

### `scan` command

Scan the codebase for env var usage and report all variables the project expects. Detect patterns like `process.env.X`, `Bun.env.X`, `import.meta.env.X`, `os.environ["X"]`, etc. across source files.

- Diff against existing `.env.example` to surface missing or unused vars
- Output as a list, or optionally generate/update the template file
- Respect `.gitignore` and configurable include/exclude globs
- Language-agnostic pattern matching (JS/TS, Python, Go, Ruby, etc.)
- **Onboarding**: new dev clones the repo, runs `envi scan`, instantly sees every env var the app needs
- **Catching drift**: someone adds `process.env.NEW_KEY` in code but forgets to update `.env.example` — `scan` catches it
- **Cleanup**: finds vars in `.env.example` that are no longer referenced anywhere in code
- **Pipeline with `setup`**: `scan` discovers what's needed, `setup` creates them in the provider

## Providers

Priority order for new provider implementations. Each provider = one entry in `PROVIDER_DEFS` + `Provider` interface implementation.

### Infisical (next)

Open-source secret manager with strong developer focus. CLI (`infisical run`), SDKs (Node, Python, Go, Ruby, Java, .NET), REST API. Project/environment/path model. 20k+ GitHub stars.

- CLI: `infisical run --env=dev --path=/apps/firefly -- npm run dev`
- Export: `infisical export --format=dotenv`
- Auth: `infisical login` (user), `INFISICAL_TOKEN` (machine)
- Docs: https://infisical.com/docs

### Doppler

Fastest-growing developer-focused secret manager. CLI (`doppler run`), REST API. Project/config model, native .env support. Loved by startups and mid-size teams.

- CLI: `doppler run -- npm start`
- Setup: `doppler setup` (links project + config)
- Auth: `doppler login` (personal), service tokens (CI)
- Docs: https://docs.doppler.com

### HashiCorp Vault

The enterprise standard. CLI (`vault kv get`), Agent (env var injection via process supervisor), SDKs for every language. 802 stacks on StackShare. Complex but powerful.

- CLI: `vault kv get -field=password secret/myapp`
- Agent: process supervisor mode with `env_template` blocks
- Auth: tokens, AppRole, OIDC, cloud IAM, and many more
- Secret paths: `secret/data/<path>` (KV v2)
- Docs: https://developer.hashicorp.com/vault

### Bitwarden Secrets Manager

Backed by Bitwarden's massive user base (millions). Open-source Rust SDK. CLI (`bws`) with `run` command for env injection.

- CLI: `bws run --project-id <id> -- npm start`
- Auth: machine account access tokens, `BW_SESSION` env var
- SDK: Rust core with Node bindings
- Docs: https://bitwarden.com/help/secrets-manager-cli/

### AWS Secrets Manager

Dominant within AWS ecosystem (29% cloud market). No native .env injection — requires scripting with `aws secretsmanager get-secret-value`. ARN-based references.

- CLI: `aws secretsmanager get-secret-value --secret-id <name>`
- Auth: IAM roles, AWS credentials
- SDKs: boto3 (Python), @aws-sdk (JS), and all major languages
- Docs: https://docs.aws.amazon.com/secretsmanager/

### Google Cloud Secret Manager

Native to GCP (13% cloud market). Simple API, no native .env injection pattern.

- CLI: `gcloud secrets versions access latest --secret=<name>`
- Auth: service accounts, application default credentials
- SDKs: all major languages
- Docs: https://cloud.google.com/secret-manager/docs

### Azure Key Vault

Microsoft ecosystem (20% cloud market). No native .env injection pattern.

- CLI: `az keyvault secret show --vault-name <vault> --name <secret>`
- Auth: Azure AD, managed identities
- SDKs: all major languages
- Docs: https://learn.microsoft.com/en-us/azure/key-vault/

