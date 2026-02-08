# Infisical Reference

Reference for integrating Infisical as an Envi provider.

Infisical is an open source platform for secrets management (plus certificates, PAM, scanning, and KMS). For Envi, the main concerns are:

- Authenticating non-interactively (machine identities)
- Fetching secrets by `(projectId, environment slug, secretPath, secretName)`
- Handling imports, folder scoping, and secret references
- Supporting self-hosted domains and custom HTTP headers

Upstream:

- Product: https://infisical.com/
- Docs: https://infisical.com/docs
- GitHub (server): https://github.com/Infisical/infisical

## Documentation Index

The Infisical docs site publishes a complete index intended for LLMs:

- Full docs index (links to _everything_): https://infisical.com/docs/llms.txt
- Full docs corpus (very large): https://infisical.com/docs/llms-full.txt

This reference links the most relevant pages for implementing the provider.

### Getting Started / Concepts

| Topic                                | URL                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| What is Infisical?                   | https://infisical.com/docs/documentation/getting-started/introduction                 |
| Cloud vs self-hosted                 | https://infisical.com/docs/documentation/getting-started/concepts/deployment-models   |
| Platform hierarchy (orgs/projects)   | https://infisical.com/docs/documentation/getting-started/concepts/platform-hierarchy  |
| Platform IAM (RBAC/ABAC overview)    | https://infisical.com/docs/documentation/getting-started/concepts/platform-iam        |
| Client ecosystem (CLI/SDK/API/agent) | https://infisical.com/docs/documentation/getting-started/concepts/client-integrations |
| Governance models (org scaling)      | https://infisical.com/docs/documentation/guides/governance-models                     |
| Organization structure guide         | https://infisical.com/docs/documentation/guides/organization-structure                |

### Self-Hosting (Domain, Networking, Hardening)

| Topic                 | URL                                                                 |
| --------------------- | ------------------------------------------------------------------- |
| Self-hosting overview | https://infisical.com/docs/self-hosting/overview                    |
| Self-hosting FAQ      | https://infisical.com/docs/self-hosting/faq                         |
| Networking            | https://infisical.com/docs/documentation/setup/networking           |
| Production hardening  | https://infisical.com/docs/self-hosting/guides/production-hardening |

Reference architectures (examples):

- AWS ECS: https://infisical.com/docs/self-hosting/reference-architectures/aws-ecs
- Linux HA: https://infisical.com/docs/self-hosting/reference-architectures/linux-deployment-ha
- On-prem K8s HA: https://infisical.com/docs/self-hosting/reference-architectures/on-prem-k8s-ha
- Google Cloud Run: https://infisical.com/docs/self-hosting/reference-architectures/google-cloud-run

### Secrets Model

| Topic                                               | URL                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Secrets management overview                         | https://infisical.com/docs/documentation/platform/secrets-mgmt/overview                  |
| Projects (envs, personal overrides, tags, comments) | https://infisical.com/docs/documentation/platform/secrets-mgmt/project                   |
| Folders (path-based secret storage)                 | https://infisical.com/docs/documentation/platform/folder                                 |
| Referencing and importing                           | https://infisical.com/docs/documentation/platform/secret-reference                       |
| Fetching secrets (delivery methods)                 | https://infisical.com/docs/documentation/platform/secrets-mgmt/concepts/secrets-delivery |
| PR workflows / approvals                            | https://infisical.com/docs/documentation/platform/pr-workflows                           |

### Audit Logs

| Topic                             | URL                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Audit logs concept page           | https://infisical.com/docs/documentation/getting-started/concepts/audit-logs                         |
| Audit logs (platform reference)   | https://infisical.com/docs/documentation/platform/audit-logs                                         |
| Audit log streaming               | https://infisical.com/docs/documentation/platform/audit-log-streams/audit-log-streams                |
| Audit log streams with Fluent Bit | https://infisical.com/docs/documentation/platform/audit-log-streams/audit-log-streams-with-fluentbit |

### Access Control / Governance (Useful For Debugging Permissions)

| Topic                    | URL                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Access controls overview | https://infisical.com/docs/documentation/platform/access-controls/overview                                  |
| RBAC                     | https://infisical.com/docs/documentation/platform/access-controls/role-based-access-controls                |
| ABAC overview            | https://infisical.com/docs/documentation/platform/access-controls/abac/overview                             |
| ABAC user metadata       | https://infisical.com/docs/documentation/platform/access-controls/abac/managing-user-metadata               |
| ABAC machine attributes  | https://infisical.com/docs/documentation/platform/access-controls/abac/managing-machine-identity-attributes |
| Additional privileges    | https://infisical.com/docs/documentation/platform/access-controls/additional-privileges                     |
| Temporary access         | https://infisical.com/docs/documentation/platform/access-controls/temporary-access                          |
| Assume privilege         | https://infisical.com/docs/documentation/platform/access-controls/assume-privilege                          |
| Access requests          | https://infisical.com/docs/documentation/platform/access-controls/access-requests                           |
| Project access requests  | https://infisical.com/docs/documentation/platform/access-controls/project-access-requests                   |

### Identity / Auth (Machine First)

| Topic                                                  | URL                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Machine identities overview                            | https://infisical.com/docs/documentation/platform/identities/machine-identities |
| Universal Auth (clientId/clientSecret -> access token) | https://infisical.com/docs/documentation/platform/identities/universal-auth     |
| Token Auth (static token on identity)                  | https://infisical.com/docs/documentation/platform/identities/token-auth         |
| API auth overview                                      | https://infisical.com/docs/api-reference/overview/authentication                |
| Service tokens (legacy, internal)                      | https://infisical.com/docs/internals/service-tokens                             |

### Security / Encryption (Background For Provider Behavior)

| Topic                      | URL                                                                          |
| -------------------------- | ---------------------------------------------------------------------------- |
| Internals overview         | https://infisical.com/docs/internals/overview                                |
| Security model             | https://infisical.com/docs/internals/security                                |
| Architecture components    | https://infisical.com/docs/internals/architecture/components                 |
| KMS configuration overview | https://infisical.com/docs/documentation/platform/kms-configuration/overview |
| AWS KMS configuration      | https://infisical.com/docs/documentation/platform/kms-configuration/aws-kms  |
| AWS HSM configuration      | https://infisical.com/docs/documentation/platform/kms-configuration/aws-hsm  |
| GCP KMS configuration      | https://infisical.com/docs/documentation/platform/kms-configuration/gcp-kms  |

### CLI (Important For Parity)

| Topic                              | URL                                             |
| ---------------------------------- | ----------------------------------------------- |
| CLI install                        | https://infisical.com/docs/cli/overview         |
| CLI quickstart + domain config     | https://infisical.com/docs/cli/usage            |
| `infisical login`                  | https://infisical.com/docs/cli/commands/login   |
| `infisical run`                    | https://infisical.com/docs/cli/commands/run     |
| `infisical secrets`                | https://infisical.com/docs/cli/commands/secrets |
| `infisical export`                 | https://infisical.com/docs/cli/commands/export  |
| `infisical token` (renew token)    | https://infisical.com/docs/cli/commands/token   |
| `infisical init`                   | https://infisical.com/docs/cli/commands/init    |
| Project config (`.infisical.json`) | https://infisical.com/docs/cli/project-config   |
| Vault storage (`infisical vault`)  | https://infisical.com/docs/cli/commands/vault   |

Additional CLI commands (generally not needed for Envi provider, but useful context):

- Dynamic secrets: https://infisical.com/docs/cli/commands/dynamic-secrets
- Bootstrap (self-host automation): https://infisical.com/docs/cli/commands/bootstrap
- Scan (secret scanning): https://infisical.com/docs/cli/commands/scan
- SSH: https://infisical.com/docs/cli/commands/ssh
- Gateway: https://infisical.com/docs/cli/commands/gateway
- Relay: https://infisical.com/docs/cli/commands/relay
- User profiles: https://infisical.com/docs/cli/commands/user
- Reset: https://infisical.com/docs/cli/commands/reset

### Node.js SDK (Most Important)

| Topic                                    | URL                                            |
| ---------------------------------------- | ---------------------------------------------- |
| Infisical Node.js SDK (`@infisical/sdk`) | https://infisical.com/docs/sdks/languages/node |

### REST API Endpoints (Provider Essentials)

| Action               | URL                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------ |
| API overview         | https://infisical.com/docs/api-reference/overview/introduction                       |
| Universal Auth login | https://infisical.com/docs/api-reference/endpoints/universal-auth/login              |
| Renew access token   | https://infisical.com/docs/api-reference/endpoints/universal-auth/renew-access-token |
| List secrets         | https://infisical.com/docs/api-reference/endpoints/secrets/list                      |
| Read secret by name  | https://infisical.com/docs/api-reference/endpoints/secrets/read                      |

## Core Concepts (As Envi Needs Them)

### Scoping: projectId, environment, secretPath

Infisical secrets are scoped by:

- `projectId`: a project identifier
- `environment`: an environment slug (commonly `dev`, `staging`, `prod`, but configurable)
- `secretPath`: a folder path (default `/`), used for path-based secret storage

When fetching secrets via SDK/API/CLI you almost always provide:

- `projectId`
- `environment` (slug)
- `secretPath` (path)

The secret name/key is then either part of the request (read single secret) or returned in a list.

`secretPath` notes:

- Default is `/`.
- `recursive=true` in the API lists secrets in the base path and subdirectories (API docs note a max depth of 20).

### Shared vs personal secrets

Infisical supports shared secrets and personal overrides. Personal overrides let a user override a shared secret value for themselves.

For machine identities, you typically only deal with shared secrets, but API endpoints may accept `type=shared|personal`.

### Secret references

Infisical secret values can reference other secrets via interpolation. Reference resolution has a permission implication:

- If `A` references `B` (possibly in another environment/folder), the client must have permissions to read _both_.

Secret reference syntax (examples from docs):

- Same env + same folder: `${KEY1}`
- Root of another environment: `${dev.KEY2}`
- Another environment + folder: `${prod.frontend.KEY2}`

Source: https://infisical.com/docs/documentation/platform/secret-reference

### Imports

Folders can import secrets from other environment/folder scopes; ordering matters ("last import wins"):

- Imports can be included/excluded in list calls (SDK/API provide flags)

Source: https://infisical.com/docs/documentation/platform/secret-reference

## Authentication

Infisical has two identity types:

- User identities (humans)
- Machine identities (workloads/automation)

For Envi provider integration, machine identities are the primary integration point.

### Universal Auth (recommended for machines)

Workflow:

1. Create machine identity
2. Configure Universal Auth for it
3. Create a client secret
4. Exchange `clientId` + `clientSecret` for a short-lived access token
5. Use the access token for secrets API calls

Universal Auth docs: https://infisical.com/docs/documentation/platform/identities/universal-auth

Important details:

- Universal Auth tokens are short-lived and may need renewal.
- The API supports scoping auth to a sub-organization via `organizationSlug`.

### Token Auth (static token on identity)

Token Auth is a simpler auth method that lets you use an access token directly (API-key-like) without an exchange step.

Token Auth docs: https://infisical.com/docs/documentation/platform/identities/token-auth

### Service tokens (legacy / deprecated)

Service tokens are project-scoped legacy tokens and are being deprecated in favor of machine identities.

- CLI: `infisical service-token` is deprecated.
- Internal details: service tokens may embed data used for decryption when using E2EE flows.

Sources:

- CLI deprecation notice: https://infisical.com/docs/cli/commands/service-token
- Internals: https://infisical.com/docs/internals/service-tokens

## Node.js SDK (`@infisical/sdk`)

Source: https://infisical.com/docs/sdks/languages/node

### Install

```bash
npm install @infisical/sdk
```

### Create a client

```ts
import { InfisicalSDK } from '@infisical/sdk'

const client = new InfisicalSDK({
  // Optional; defaults to https://app.infisical.com
  siteUrl: 'https://your-infisical-instance.com',
})
```

### Authenticate (Universal Auth)

```ts
await client.auth().universalAuth.login({
  clientId: process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID!,
  clientSecret: process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET!,
})
```

Token renewal (Universal Auth):

```ts
await client.auth().universalAuth.renew()
```

You can also set an access token directly:

```ts
client.auth().accessToken(process.env.INFISICAL_TOKEN!)
```

### List secrets

```ts
const resp = await client.secrets().listSecrets({
  projectId: '<project-id>',
  environment: 'dev',
  secretPath: '/',
  recursive: false,
  includeImports: false,
  expandSecretReferences: true,
  viewSecretValue: true,
  // Optional: filter by tags
  // tagFilters: ['tag-slug-1', 'tag-slug-2'],
})

console.log(resp)
```

Notes:

- `includeImports` (SDK) and `include_imports` (API) control whether imported secrets are included.
- `expandSecretReferences` controls whether references are expanded.
- `viewSecretValue=false` will mask values with `<hidden-by-infisical>`.

### List secrets with imports merged

```ts
const secrets = await client.secrets().listSecretsWithImports({
  projectId: '<project-id>',
  environment: 'dev',
  secretPath: '/',
  recursive: false,
  expandSecretReferences: true,
  viewSecretValue: true,
})
```

The docs note that the selected environment takes precedence over imported secrets when key collisions exist.

### Get a secret by name

```ts
const secret = await client.secrets().getSecret({
  projectId: '<project-id>',
  environment: 'dev',
  secretPath: '/',
  secretName: 'DATABASE_URL',
  expandSecretReferences: true,
  includeImports: true,
  viewSecretValue: true,
})
```

### Implication for Envi

For Envi, the Node SDK is the preferred integration surface because:

- It is the official client abstraction used by Infisical.
- It exposes explicit controls for imports and reference expansion.
- It reduces the chance of mismatching API versions/params.

## Comparison: Infisical vs 1Password (For Envi Provider Design)

Envi's existing providers (notably 1Password) are reference/URI-centric. Infisical is scope-centric.

Related internal reference:

- `references/1password.md`

### Where they feel similar

- CLI-first local development: run a command that injects secrets into a subprocess.
  - Infisical: `infisical run -- <command>` (supports `--watch` to restart on secret changes)
  - 1Password: `op run -- <command>`

- Non-interactive automation support.
  - Infisical: machine identities (commonly Universal Auth clientId/clientSecret -> short-lived access token)
  - 1Password: service accounts (longer-lived service account token)

- Official Node.js SDK exists to fetch secrets without calling REST endpoints directly.

### Key differences

- Secret addressing model:
  - 1Password: `op://vault/item/field` URIs are the primary locator and are used directly in templates.
  - Infisical: secrets are addressed by `(projectId, environmentSlug, secretPath, secretKey)`; the official UX is to select a scope and fetch secrets for that scope.

- Template injection model:
  - 1Password: `op inject` scans arbitrary files for `op://...` references and replaces them.
  - Infisical: the built-in flows are scope materialization:
    - `infisical run`: fetch scope -> inject environment variables
    - `infisical export`: fetch scope -> output dotenv/json/yaml/csv or render via a Go template
      It is less about resolving URIs embedded in arbitrary files.

- Reference expansion semantics:
  - Infisical supports `${...}` references inside secret values; API/SDK have `expandSecretReferences` to control whether they are expanded server-side.
  - Expanding references requires the identity to have read permissions to referenced secrets.

### Practical implication for Envi (current recommendation)

Do not invent an `infisical://...` reference scheme yet.

Instead, integrate Infisical as a provider that can resolve secrets by scope:

- Required inputs at runtime:
  - instance base URL (`siteUrl`)
  - auth (Universal Auth clientId/clientSecret or an access token)
  - scope (`projectId`, `environment`, `secretPath`)
- Optional behavior toggles:
  - `includeImports`
  - `expandSecretReferences`
  - `recursive`
  - tag/metadata filters (when needed)

## Proposed Envi Convention For Infisical (Keep `envi://...`)

Envi's provider engine is reference-driven today: it detects `envi://...` in templates and asks the configured provider to resolve those references.

Infisical is scope-driven (project/env/path), so the provider needs a deterministic mapping from Envi's `envi://vault/item/field` shape to Infisical inputs.

### Canonical reference format

Use this format in `.env.example` when the selected provider is Infisical:

- `envi://<projectId>/<environment>/<secretPath...>/<secretKey>`

Mapping:

- `vault` -> `projectId`
- `item` -> `environment` (Infisical environment slug)
- `field` (which may contain `/`) -> `secretPath + secretKey`
  - The last segment is the `secretKey`
  - The preceding segments (if any) form the `secretPath` (default `/`)

Examples:

```dotenv
# Root folder
DATABASE_URL=envi://6f2c3b0f-.../dev/DATABASE_URL

# Nested folder path (/apps/api)
JWT_SECRET=envi://6f2c3b0f-.../prod/apps/api/JWT_SECRET
```

### Relationship to `${ENV}`

Envi supports `${ENV}` substitution inside secret references. That can be used to route different Envi environments to different Infisical environments, as long as the substituted value is a real Infisical environment slug.

Example:

```dotenv
DATABASE_URL=envi://6f2c3b0f-.../${ENV}/DATABASE_URL
```

Notes:

- Infisical accepts only environment slugs that exist in the project (commonly `dev`, `staging`, `prod`).
- Envi's default environment is `local`; if you want `local` to map to an Infisical slug like `dev`, Envi would need an explicit env-mapping feature.

### Why not `infisical://...`?

Infisical's official CLI/SDK are not URI-centric (unlike 1Password's `op://...`). Introducing `infisical://...` would create a new, Envi-only dialect that users can't reuse elsewhere.

By keeping `envi://...` and translating it in the provider implementation, Envi stays consistent across providers while still supporting Infisical's scope model.

## Caveats / Limitations

These are the main pitfalls when integrating Infisical into Envi while keeping `envi://...` references.

- Not an official URI scheme: Infisical CLI/SDK do not define a stable `infisical://...` reference format. Our `envi://<projectId>/<env>/<path...>/<key>` convention is Envi-specific.

- "vault/item/field" semantics differ from 1Password:
  - In 1Password, `op://vault/item/field` maps naturally to 1Password concepts.
  - In Infisical, Envi's `vault/item/field` becomes `projectId/environment/secretPath+secretKey`. This is intuitive once documented, but it is a semantic repurpose.

- Environment slugs must exist: `${ENV}` substitution is only safe if it substitutes to a real Infisical environment slug (e.g. `dev`, `staging`, `prod`). Envi's default `local` will not match most Infisical projects unless you create such an environment or add an env-mapping feature.

- `secretPath` parsing rules must be nailed down:
  - The canonical format treats the last segment as `secretKey` and everything before it (after env) as `secretPath`.
  - `secretPath` can be `/` (root) or nested (e.g. `/apps/api`).
  - Keys that contain `/` are not representable in this convention (Infisical secret keys are typically simple identifiers, so this is usually fine).

- Permission + reference expansion coupling:
  - `expandSecretReferences=true` expands `${...}` references in secret values.
  - Expansion requires the calling identity to have permission to read referenced secrets; otherwise resolution may fail even if the top-level key is readable.

- Imports change what "the value" means:
  - If `includeImports=true`, a scope can include secrets imported from other paths/envs.
  - Collision behavior matters (selected environment typically takes precedence). Envi should choose a consistent default and document it.

- Token lifecycle:
  - Universal Auth access tokens are short-lived; provider must renew on expiry (or re-login).
  - CI usage should prefer machine identity auth, not interactive user login.

- Instance routing and headers:
  - Infisical supports multiple clouds (US/EU) and self-hosting; `siteUrl` must be configurable.
  - The Infisical CLI supports `INFISICAL_CUSTOM_HEADERS` for environments protected by proxies (e.g. Cloudflare Access). If Envi uses the Node SDK, we may need extra work to support equivalent headers.

- Provider interface mismatch: Envi's `Provider.listVaults()` is a natural fit for 1Password/Proton Pass but not for Infisical.
  - Infisical has orgs/projects/folders, not "vaults".
  - For Infisical, `listVaults()` may need to be a best-effort (e.g., list projects) or return an empty list, depending on how Envi uses it.

## Infisical CLI (What We Need To Mirror)

CLI overview: https://infisical.com/docs/cli/overview

### Domain / instance configuration

Infisical CLI defaults to US cloud. For EU/self-hosted instances, it must be configured:

- Set `INFISICAL_API_URL` (recommended)
- Or pass `--domain` on every command

Source: https://infisical.com/docs/cli/usage

The CLI also supports custom HTTP headers for instances protected by additional auth (e.g. Cloudflare Access):

- `INFISICAL_CUSTOM_HEADERS="Header=Value Other=Value"`

Source: https://infisical.com/docs/cli/usage

### Key commands

- `infisical login`: supports user login (browser/direct/interactive) and machine identity methods (universal-auth, aws-iam, kubernetes, etc.)
  https://infisical.com/docs/cli/commands/login

- `infisical secrets`: CRUD and folder operations; supports `--env`, `--path`, `--projectId`, `--expand`
  https://infisical.com/docs/cli/commands/secrets

- `infisical export`: export secrets to dotenv/json/yaml/csv or Go-template rendering
  https://infisical.com/docs/cli/commands/export

- `infisical run`: inject secrets into a subprocess; supports `--watch` to restart on changes
  https://infisical.com/docs/cli/commands/run

### CLI environment variables (not exhaustive)

- `INFISICAL_TOKEN`: access token used for machine identity auth or (legacy) service tokens
- `INFISICAL_API_URL`: instance base URL
- `INFISICAL_CUSTOM_HEADERS`: extra headers for all requests
- `INFISICAL_DISABLE_UPDATE_CHECK=true`: disable update check for performance/CI

Login-related environment variables (documented as flag substitutes in `infisical login`):

- Universal Auth:
  - `INFISICAL_UNIVERSAL_AUTH_CLIENT_ID`
  - `INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET`
- Machine identity ID (for other auth methods like AWS IAM, Kubernetes, etc):
  - `INFISICAL_MACHINE_IDENTITY_ID`
- Sub-organization scoping:
  - `INFISICAL_AUTH_ORGANIZATION_SLUG`
- User direct login (non-interactive):
  - `INFISICAL_EMAIL`
  - `INFISICAL_PASSWORD`
  - `INFISICAL_ORGANIZATION_ID`
- JWT input (OIDC/JWT auth methods):
  - `INFISICAL_JWT`

Source: https://infisical.com/docs/cli/commands/login

### Export formats and templating

`infisical export` supports exporting secrets in multiple formats:

- `--format=dotenv` (default)
- `--format=dotenv-export` (prefixes lines with `export `)
- `--format=json`
- `--format=yaml`
- `--format=csv`

It also supports rendering secrets using a custom template file:

- `infisical export --template=/path/to/template`

The template syntax is Go-template-like and can call helper functions such as `secret "<projectId>" "<envSlug>" "<folderPath>"` to fetch secrets.

Source: https://infisical.com/docs/cli/commands/export

Sources:

- https://infisical.com/docs/cli/usage
- https://infisical.com/docs/cli/commands/run
- https://infisical.com/docs/cli/commands/secrets
- https://infisical.com/docs/cli/commands/export

### Project config file (`.infisical.json`) and docs mismatch

Infisical's quickstart and project-config docs describe `.infisical.json`, while the `init` page mentions `infisical.json`.

- Quickstart (mentions `.infisical.json`): https://infisical.com/docs/cli/usage
- Project config page (shows `.infisical.json`): https://infisical.com/docs/cli/project-config
- `init` page (mentions `infisical.json`): https://infisical.com/docs/cli/commands/init

Assume `.infisical.json` is the correct file name (the majority of docs use it), and verify the actual file name/shape against the CLI version you target.

## REST API (Provider Essentials)

API overview: https://infisical.com/docs/api-reference/overview/introduction

### Base URLs and domains

Docs and OpenAPI examples reference multiple hostnames:

- UI + SDK default: `https://app.infisical.com`
- EU cloud: `https://eu.infisical.com`
- OpenAPI server examples: `https://us.infisical.com`, `https://eu.infisical.com`, `http://localhost:8080`

For implementation, treat the instance base as a configurable `siteUrl` and do not hardcode a single host.

### Versioning

API versions vary by resource (e.g. `/api/v4/secrets` vs `/api/v1/auth/...`). Use the latest for each endpoint.

Source: https://infisical.com/docs/api-reference/overview/introduction

### Rate limits (Infisical Cloud)

Infisical Cloud enforces per-plan rate limits (read/write/secret/etc). Self-hosted instances have no limits.

Source: https://infisical.com/docs/api-reference/overview/introduction

### Universal Auth login

Endpoint:

- `POST /api/v1/auth/universal-auth/login`

Docs: https://infisical.com/docs/api-reference/endpoints/universal-auth/login

Request body:

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "organizationSlug": "optional-sub-org-slug"
}
```

Response:

```json
{
  "accessToken": "...",
  "expiresIn": 7200,
  "accessTokenMaxTTL": 43200,
  "tokenType": "Bearer"
}
```

### Renew access token

Endpoint:

- `POST /api/v1/auth/token/renew`

Docs: https://infisical.com/docs/api-reference/endpoints/universal-auth/renew-access-token

Request body:

```json
{ "accessToken": "..." }
```

### List secrets

Endpoint:

- `GET /api/v4/secrets`

Docs: https://infisical.com/docs/api-reference/endpoints/secrets/list

Key query params:

- `projectId` (string)
- `environment` (string, environment slug)
- `secretPath` (string, default `/`)
- `recursive=true|false`
- `include_imports=true|false`
- `expandSecretReferences=true|false`
- `viewSecretValue=true|false`
- `tagSlugs=...` (comma-separated)
- `metadataFilter=...` (key/value filter syntax described in OpenAPI)

### Get secret by name

Endpoint:

- `GET /api/v4/secrets/{secretName}`

Docs: https://infisical.com/docs/api-reference/endpoints/secrets/read

Key query params:

- `projectId` (required)
- `environment` (optional)
- `secretPath` (optional)
- `type=shared|personal` (optional)
- `version` (optional)
- `expandSecretReferences=true|false`
- `include_imports=true|false`
- `viewSecretValue=true|false`

## Implementation Notes For Envi (Provider Design)

### Recommended integration approach

Prefer using the Node.js SDK (`@infisical/sdk`) inside Envi over calling REST endpoints directly:

- The SDK already exposes flags needed for correct behavior (`includeImports`, reference expansion, etc.)
- It avoids per-endpoint API-version churn
- It is more likely to handle encryption/decryption details correctly across configurations

### Mapping to Envi secret references

Infisical does not have a widely-used public URI scheme like `op://` or `pass://`. For Envi, we will need to define a stable reference format that can always be mapped to API/SDK inputs.

The minimal unique locator for a secret value is:

- `siteUrl` (Infisical instance)
- `projectId`
- `environment` (slug)
- `secretPath` (folder path)
- `secretName`

Practical Envi reference format candidates:

1. `infisical://<projectId>/<environment>/<secretPath>/<secretName>`
2. `infisical://<environment>/<projectId>/<secretPath>/<secretName>`
3. `infisical://<projectId>?env=dev&path=/apps/api&name=DATABASE_URL`

Notes:

- `secretPath` itself contains `/`, so a path-segment format must either URL-encode it or treat it as the "rest" of the path.
- `environment` default is typically `dev`, and `secretPath` default is `/`.

### Provider configuration inputs (expected)

When Envi implements the provider, it will likely need:

- `siteUrl`: instance URL (default `https://app.infisical.com`)
- `auth`:
  - Universal Auth: `clientId` + `clientSecret` (+ optional `organizationSlug`)
  - OR a pre-issued access token (Token Auth or Universal Auth token)

CLI parity suggests supporting domain + custom headers (for Cloudflare Access / proxies).

## Troubleshooting Notes

- Wrong instance/region: configure `siteUrl` (SDK) or `INFISICAL_API_URL`/`--domain` (CLI)
- Token expiry: renew token (SDK `universalAuth.renew()`; CLI `infisical token renew <token>`; API `POST /api/v1/auth/token/renew`)
- Secret references not expanding: ensure `expandSecretReferences=true` and that identity has permissions to read _referenced_ secrets
- Missing imported secrets: ensure `includeImports=true` (SDK) or `include_imports=true` (API)
- Values hidden: `viewSecretValue=false` will mask values as `<hidden-by-infisical>` (SDK docs)
