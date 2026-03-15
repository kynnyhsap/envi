# HashiCorp Vault Reference

Implementation-oriented notes for integrating HashiCorp Vault as an Envi provider.

Scope: how to authenticate non-interactively and resolve secret values (primarily the KV secrets engine) via CLI, Node.js, or HTTP API.

Upstream:

- Product: https://www.hashicorp.com/products/vault
- Docs (start here): https://developer.hashicorp.com/vault
- GitHub (Vault): https://github.com/hashicorp/vault
- GitHub (TypeScript client): https://github.com/hashicorp/vault-client-typescript

## Documentation Index

Treat these as the canonical entry points for provider implementation work:

| Topic                                            | URL                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| Docs landing page                                | https://developer.hashicorp.com/vault/docs                                   |
| CLI usage + env vars (index)                     | https://developer.hashicorp.com/vault/docs/commands                          |
| HTTP API (index)                                 | https://developer.hashicorp.com/vault/api-docs                               |
| HTTP API client libraries list                   | https://developer.hashicorp.com/vault/api-docs/libraries                     |
| KV secrets engine (concepts + v1/v2 differences) | https://developer.hashicorp.com/vault/docs/secrets/kv                        |
| KV v1 API                                        | https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v1               |
| KV v2 API                                        | https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2               |
| AppRole auth (machine-friendly)                  | https://developer.hashicorp.com/vault/docs/auth/approle                      |
| Kubernetes auth (workload identity)              | https://developer.hashicorp.com/vault/docs/auth/kubernetes                   |
| JWT auth (OIDC/JWT)                              | https://developer.hashicorp.com/vault/docs/auth/jwt                          |
| Token auth + token header behavior               | https://developer.hashicorp.com/vault/docs/auth/token                        |
| Token concepts (renewal/TTL types)               | https://developer.hashicorp.com/vault/docs/concepts/tokens                   |
| Enterprise namespaces (concepts)                 | https://developer.hashicorp.com/vault/docs/enterprise/namespaces             |
| Auto-auth (Vault Agent/Proxy)                    | https://developer.hashicorp.com/vault/docs/agent-and-proxy/autoauth          |
| Generate OpenAPI for mounted backends            | https://developer.hashicorp.com/vault/api-docs/system/internal-specs-openapi |

## Core Concepts (As Envi Needs Them)

### Secret addressing: mounts + paths + keys

Vault is not URI-scheme-first (unlike `op://` or `pass://`). In practice, a secret value is addressed by:

- Vault base URL (`VAULT_ADDR`)
- Optional namespace (`X-Vault-Namespace` / `VAULT_NAMESPACE`) for Enterprise / HCP Vault Dedicated
- Secrets engine mount path (commonly `secret`, but configurable)
- Secret path under the mount (e.g. `apps/api`)
- A key within the returned JSON map (e.g. `DATABASE_URL`)

For KV:

- KV v1 reads at `/<mount>/<path>`.
- KV v2 reads at `/<mount>/data/<path>` and lists at `/<mount>/metadata/<path>`.

Sources:

- KV v1 API paths: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v1
- KV v2 API paths: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2
- KV v1 vs v2 comparison: https://developer.hashicorp.com/vault/docs/secrets/kv

### Authentication: client token headers

Vault HTTP API calls generally require a client token once Vault is unsealed. The token can be sent as either:

- `X-Vault-Token: <token>`
- `Authorization: Bearer <token>`

Source: https://developer.hashicorp.com/vault/api-docs

## CLI (`vault`)

CLI docs index: https://developer.hashicorp.com/vault/docs/commands

### Install

Vault installation page (includes Homebrew, APT, RPM, binary downloads):

- https://developer.hashicorp.com/vault/install

Common installs (from official docs):

```bash
# macOS
brew tap hashicorp/tap
brew install hashicorp/tap/vault

# Ubuntu/Debian
wget -O - https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(grep -oP '(?<=UBUNTU_CODENAME=).*' /etc/os-release || lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update && sudo apt install vault
```

Source: https://developer.hashicorp.com/vault/install

### Key CLI environment variables (connection + behavior)

The Vault CLI supports flags and equivalent `VAULT_*` environment variables. The CLI usage page documents the full list; the ones that typically matter for an Envi provider:

- `VAULT_ADDR` (Vault server address) and `-address`
- `VAULT_AGENT_ADDR` (Vault Agent address) and `-agent-address`
- `VAULT_TOKEN` (service token) or `vault login`
- `VAULT_NAMESPACE` (Enterprise namespaces) and `-namespace` / `-ns`
- TLS:
  - `VAULT_CACERT`, `VAULT_CAPATH`
  - `VAULT_CLIENT_CERT`, `VAULT_CLIENT_KEY`
  - `VAULT_TLS_SERVER_NAME`
  - `VAULT_SKIP_VERIFY` (not appropriate for production)
- Output: `VAULT_FORMAT`
- Proxies: `VAULT_PROXY_ADDR` (and legacy `VAULT_HTTP_PROXY`)

Source: https://developer.hashicorp.com/vault/docs/commands

### Token caching (token helper)

After `vault login`, the CLI caches the token via a token helper (default token file: `~/.vault-token`).

Sources:

- CLI token caching + default token file: https://developer.hashicorp.com/vault/docs/commands#authenticating-to-vault
- Token helper customization: https://developer.hashicorp.com/vault/docs/commands/token-helper

### Authenticate

`vault login` writes a token to the token helper by default:

```bash
vault login
```

You can also provide a token directly (note shell history / process listing risk):

```bash
vault login hvs.xxxxx
```

Source: https://developer.hashicorp.com/vault/docs/commands/login

Machine-oriented auth example (AppRole) using the generic `write` command:

```bash
vault write auth/approle/login role_id="$ROLE_ID" secret_id="$SECRET_ID"
```

Source: https://developer.hashicorp.com/vault/docs/auth/approle

### Read a single secret value (KV)

KV v2 and v1 both use `vault kv get`. Use `-mount` to avoid KV v2 `/data/` confusion.

```bash
# Read entire secret at <mount>/<path>
vault kv get -mount=secret creds

# Read just one key from the secret data map
vault kv get -mount=secret -field=passcode creds

# Read a specific version (KV v2 only)
vault kv get -mount=secret -version=2 creds
```

Source: https://developer.hashicorp.com/vault/docs/commands/kv/get

### List keys under a prefix (KV)

```bash
vault kv list -mount=secret my-app/
```

Notes:

- The input must be a folder/prefix; folders are suffixed with `/`.
- Key names are not policy-filtered; do not encode sensitive data in key names.

Source: https://developer.hashicorp.com/vault/docs/commands/kv/list

## Node.js SDK

Vault's HTTP API is the source of truth.

HashiCorp does not list an official Node.js client on its client libraries page; the Node.js options there are community-maintained.

- Client libraries list (Node.js is under Community): https://developer.hashicorp.com/vault/api-docs/libraries

HashiCorp also maintains an OpenAPI-generated TypeScript/JavaScript client in the `hashicorp` GitHub org:

- GitHub: https://github.com/hashicorp/vault-client-typescript

This client is generated from Vault's OpenAPI output (`/sys/internal/specs/openapi`):

- https://developer.hashicorp.com/vault/api-docs/system/internal-specs-openapi

### Community SDK: `node-vault`

Vault's docs list `node-vault` as a community-maintained Node.js library:

- Vault client libraries list: https://developer.hashicorp.com/vault/api-docs/libraries
- GitHub (node-vault): https://github.com/kr1sp1n/node-vault

Install:

```bash
npm install -S node-vault
```

Source: https://raw.githubusercontent.com/kr1sp1n/node-vault/master/README.md

Initialize and read a KV v2 secret (note the `/data/` path segment):

```js
async function main() {
  const client = require('node-vault')({
    apiVersion: 'v1',
    endpoint: process.env.VAULT_ADDR,
    token: process.env.VAULT_TOKEN,
  })

  const resp = await client.read('secret/data/creds')

  // KV v2 response wraps the secret map at data.data
  const passcode = resp.data?.data?.passcode
  console.log(passcode)
}

main().catch(console.error)
```

Sources:

- node-vault read example: https://raw.githubusercontent.com/kr1sp1n/node-vault/master/README.md
- KV v2 read endpoint + response shape: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2

### OpenAPI-generated client: `@hashicorp/vault-client-typescript`

#### Install

The repository README shows `npm install @hashicorp/vault-client-typescript@<version>`:

- https://raw.githubusercontent.com/hashicorp/vault-client-typescript/main/README.md

Package on npm:

- https://www.npmjs.com/package/@hashicorp/vault-client-typescript

#### Client initialization

Important: the generated client builds paths like `/{mount}/data/{path}` and then prefixes them with `configuration.basePath`.
In practice, set `basePath` to include `/v1` (since Vault API routes are prefixed with `/v1/`).

Sources:

- Vault API prefix: https://developer.hashicorp.com/vault/api-docs
- Client path building example (KV v2 read uses `/{kv_v2_mount_path}/data/{path}`): https://raw.githubusercontent.com/hashicorp/vault-client-typescript/main/src/apis/SecretsApi.ts
- Client config supports `basePath` + default `headers`: https://raw.githubusercontent.com/hashicorp/vault-client-typescript/main/src/runtime.ts

Example (token auth):

```ts
import { Configuration, SecretsApi } from '@hashicorp/vault-client-typescript'

const addr = process.env.VAULT_ADDR! // e.g. https://vault.example.com:8200
const token = process.env.VAULT_TOKEN!
const namespace = process.env.VAULT_NAMESPACE // optional

const config = new Configuration({
  basePath: `${addr.replace(/\/+$/, '')}/v1`,
  headers: {
    'X-Vault-Token': token,
    ...(namespace ? { 'X-Vault-Namespace': namespace } : {}),
    // If you are talking to a Vault Proxy with require_request_header enabled:
    // 'X-Vault-Request': 'true',
  },
})

const secrets = new SecretsApi(config)
```

Token header behavior and namespaces:

- `X-Vault-Token` / `Authorization: Bearer`: https://developer.hashicorp.com/vault/api-docs

#### Authenticate (AppRole example)

AppRole is explicitly oriented to automated workflows (machines/services):

- https://developer.hashicorp.com/vault/docs/auth/approle

Using the generated client:

```ts
import { AuthApi, Configuration } from '@hashicorp/vault-client-typescript'

const addr = process.env.VAULT_ADDR!

const unauthConfig = new Configuration({
  basePath: `${addr.replace(/\/+$/, '')}/v1`,
})

const auth = new AuthApi(unauthConfig)

const resp = await auth.appRoleLogin('approle', {
  role_id: process.env.VAULT_APPROLE_ROLE_ID!,
  secret_id: process.env.VAULT_APPROLE_SECRET_ID!,
})

// Login endpoints return the token at auth.client_token in the raw HTTP API response.
// Depending on the generated types, you may need to cast resp.auth to access client_token.
const clientToken = (resp.auth as any)?.client_token as string
```

Source for response token location: https://developer.hashicorp.com/vault/docs/auth/approle

#### Get a secret (KV v2)

```ts
import { SecretsApi } from '@hashicorp/vault-client-typescript'

const secret = await secrets.kvV2Read('creds', 'secret')
const data = secret.data as Record<string, unknown> | undefined
const passcode = data?.passcode
```

API doc for KV v2 read endpoint: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2

#### List keys (KV v2)

The generated client implements KV v2 listing as a GET to the metadata path with a `list` query parameter.
Vault's API docs note that listing can be performed with the `LIST` verb or `GET ?list=true`.

```ts
import { KvV2ListListEnum } from '@hashicorp/vault-client-typescript'

const resp = await secrets.kvV2List('my-app', 'secret', KvV2ListListEnum.TRUE)
console.log(resp.keys)
```

Sources:

- KV v2 list API: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2
- Generated client path/query behavior: https://raw.githubusercontent.com/hashicorp/vault-client-typescript/main/src/apis/SecretsApi.ts

#### Caveat: KV v2 version reads in the generated client

The KV v2 HTTP API supports reading a specific version via `?version=<int>`.
However, in `@hashicorp/vault-client-typescript` (generated from Vault 1.21.0 OpenAPI), `kvV2Read()` does not expose a `version` parameter.

Sources:

- KV v2 read supports `version`: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2
- Generated client `kvV2Read()` request interface has no version: https://raw.githubusercontent.com/hashicorp/vault-client-typescript/main/src/apis/SecretsApi.ts

If Envi needs version selection for KV v2, either:

1. Call the REST endpoint directly for that one case, or
2. Use a client middleware to append the query parameter before fetch.

## REST API (Minimal Endpoints For Envi)

API index: https://developer.hashicorp.com/vault/api-docs

### Base URL and headers

- All routes are prefixed with `/v1/`: https://developer.hashicorp.com/vault/api-docs
- Token header: `X-Vault-Token` or `Authorization: Bearer <token>`: https://developer.hashicorp.com/vault/api-docs
- Namespaces: `X-Vault-Namespace: ns1/ns2/` makes the request path relative to that namespace: https://developer.hashicorp.com/vault/api-docs
- Some proxies require `X-Vault-Request: true` (Vault CLI and SDK always include it): https://developer.hashicorp.com/vault/api-docs#the-x-vault-request-header

### Auth (automation-friendly)

Pick one auth method appropriate for where Envi runs, then exchange it for a client token.

- AppRole login:
  - `POST /v1/auth/approle/login`
  - request body includes `role_id` + `secret_id`
  - response token at `auth.client_token`
  - Docs: https://developer.hashicorp.com/vault/docs/auth/approle

- Kubernetes login:
  - `POST /v1/auth/kubernetes/login`
  - request body includes `jwt` + `role`
  - response token at `auth.client_token`
  - Docs: https://developer.hashicorp.com/vault/docs/auth/kubernetes

- JWT login:
  - `POST /v1/auth/jwt/login`
  - request body includes `jwt` + `role`
  - response token at `auth.client_token`
  - Docs: https://developer.hashicorp.com/vault/docs/auth/jwt

### Read a KV secret (KV v2)

- Read latest secret version:
  - `GET /v1/:secret-mount-path/data/:path`
  - Docs: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2

- Read specific version:
  - `GET /v1/:secret-mount-path/data/:path?version=:version-number`
  - Docs: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2

Response shape (KV v2) includes nested data at `data.data`:

```json
{
  "data": {
    "data": { "foo": "bar" },
    "metadata": { "version": 2 }
  }
}
```

Source: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2

### List KV keys (KV v2)

- List keys:
  - `LIST /v1/:secret-mount-path/metadata/:path`
  - Docs: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2

Important permission note: KV v2 listing requires `list` capability on the `/metadata/` path, even if reads go through `/data/`.

Source: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2

### Read a KV secret (KV v1)

- Read secret:
  - `GET /v1/secret/:path` (assuming mount `secret/`)
  - Docs: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v1

### List KV keys (KV v1)

- List keys:
  - `LIST /v1/secret/:path` (assuming mount `secret/`)
  - Docs: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v1

## Proposed Envi Mapping (Keep `envi://...`)

Vault does not define an official `vault://...` secret reference scheme. For Envi templates, keep `envi://...` and translate it in the Vault provider.

### Canonical reference format for KV

Use this format in `.env.example` when provider is Vault:

- `envi://<mount>/<path...>/<key>`

Mapping:

- `vault` (first segment) -> KV mount path (e.g. `secret`)
- `item` (middle segments) -> secret path (e.g. `apps/api`)
- `field` (last segment) -> key inside the secret's data map (e.g. `DATABASE_URL`)

Examples:

```dotenv
# KV v2 mounted at "secret" and secret at "apps/api" with key "DATABASE_URL"
DATABASE_URL=envi://secret/apps/api/DATABASE_URL

# Use ${ENV} to route to different secret paths (Envi substitution)
DATABASE_URL=envi://secret/apps/${ENV}/DATABASE_URL
```

Optional query parameters (Envi-specific) that map naturally to Vault KV v2:

- `?version=<int>` -> KV v2 read version (`/data/:path?version=`)

KV v2 version semantics:

- CLI supports `vault kv get -version=<int>`: https://developer.hashicorp.com/vault/docs/commands/kv/get
- HTTP API supports `?version=<int>`: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2

## Envi Provider Implementation Notes

This section captures a concrete, low-risk way to implement a Vault provider in Envi given the current provider architecture.

### Provider registration and reference scheme

Envi's SDK resolves references by converting `envi://...` into a provider-native scheme via `toNativeReference()`, then passes that native string to `Provider.resolveSecret()` / `Provider.resolveSecrets()`.

Code references:

- Provider interface: `src/providers/provider.ts`
- Scheme registry + conversion: `src/providers/index.ts`
- Resolution flow: `src/sdk/operations/resolve-secrets.ts`

Vault does not define an official `vault://...` secret scheme, but Envi currently expects every provider to have a `scheme` string. The minimal-change approach is:

- Use `vault://` as an Envi-internal native scheme (only used inside Envi), while keeping templates as `envi://...`.
- Register the provider in `src/providers/index.ts` with `scheme: 'vault://'`.

Also note: the CLI `validate` command hardcodes known schemes for pretty-printing. If you add `vault://`, update:

- `src/commands/validate.command.ts`

### Parsing `envi://` for Vault KV

Given Envi's `parseSecretReference()` shape (`vault`, `item`, `field`) and its support for slashes in `field`:

- KV mount path: `mount = vault`
- Secret path: `secretPath = item + '/' + fieldPrefix`
- Key name: `key = lastSegment(field)`

Example:

- `envi://secret/apps/api/DATABASE_URL`
  - mount: `secret`
  - secret path: `apps/api`
  - key: `DATABASE_URL`

### Recommended backend: Vault CLI first

Start with a CLI backend because it already supports Vault's connection and auth ergonomics (TLS options, proxies, namespaces, Vault Agent, token helper).

- Availability check: run `vault version`.
- Auth verification: run `vault token lookup -format=json`.
  - CLI docs: https://developer.hashicorp.com/vault/docs/commands/token/lookup
  - Under the hood, this uses `/auth/token/lookup-self`: https://developer.hashicorp.com/vault/api-docs/auth/token#lookup-a-token-self

Secret resolution:

- Read one key:
  - `vault kv get -mount=<mount> -field=<key> <secretPath>`
  - KV CLI docs: https://developer.hashicorp.com/vault/docs/commands/kv/get
- KV v2 version reads:
  - `vault kv get -mount=<mount> -field=<key> -version=<n> <secretPath>`
  - KV CLI docs: https://developer.hashicorp.com/vault/docs/commands/kv/get

`listVaults()` mapping:

Vault does not have a "vault" concept like 1Password/Proton Pass. The closest useful thing for Envi is listing KV mounts.

- Use `vault secrets list -format=json` and filter to mounts where `type == "kv"`.
  - CLI docs: https://developer.hashicorp.com/vault/docs/commands/secrets/list

### Optional backend: direct HTTP

If you want "no external binaries" support, add an HTTP backend.

Auth verification:

- `GET /v1/auth/token/lookup-self` with `X-Vault-Token`.
  - API docs: https://developer.hashicorp.com/vault/api-docs/auth/token#lookup-a-token-self

KV reads:

- KV v2: `GET /v1/<mount>/data/<path>` (and `?version=<n>` when needed)
  - API docs: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2
- KV v1: `GET /v1/<mount>/<path>`
  - API docs: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v1#read-secret

KV version detection:

- Best-effort: `GET /v1/sys/mounts` and inspect mount entries where `type == "kv"` and `options.version`.
  - API docs: https://developer.hashicorp.com/vault/api-docs/system/mounts#list-mounted-secrets-engines

Important: Vault can return 404 for missing paths and for some permission scenarios. "Try v2 then v1" can mislead if the caller lacks permissions.

### Suggested provider settings

If a Vault provider is added later, use provider-specific settings (env vars + config file) while keeping the CLI provider-agnostic:

- `backend=auto|cli|http` (default `auto`, which prefers `cli`)
- `cliBinary=vault`
- `addr=<url>` (default from `VAULT_ADDR`)
- `namespace=<ns>` (default from `VAULT_NAMESPACE`)
- `token=<token>` (default from `VAULT_TOKEN`)
- `tokenFile=<path>` (optional; default fallback is `~/.vault-token`)
- `xVaultRequest=true` (only if talking to a proxy that requires it)

See Vault API header behavior:

- Token headers + namespaces: https://developer.hashicorp.com/vault/api-docs
- `X-Vault-Request` header: https://developer.hashicorp.com/vault/api-docs#the-x-vault-request-header

## Caveats / Limitations

- No official URI scheme: Vault does not provide a stable `vault://...` reference syntax; any `envi://...` mapping is Envi-specific.

- KV v1 vs KV v2 path differences are easy to mix up. KV v2 uses `/data/` for reads and `/metadata/` for lists; the CLI hides some of this unless you use `-mount`.
  - KV overview: https://developer.hashicorp.com/vault/docs/secrets/kv

- KV v2 listing permissions: listing requires `list` on the `/metadata/` path, even if reads work via `/data/`.
  - KV v2 list docs: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2

- Namespaces (Enterprise/HCP Vault Dedicated): requests can be relative to `X-Vault-Namespace`. HCP Vault Dedicated requires explicitly targeting a namespace (top-level is `admin`).
  - Namespaces behavior: https://developer.hashicorp.com/vault/api-docs

- Proxies may require `X-Vault-Request: true`. The Vault CLI always adds it; Envi may need to allow a provider option to add this header.
  - Header docs: https://developer.hashicorp.com/vault/api-docs#the-x-vault-request-header

- Token lifecycle: tokens can be renewable or not, can be periodic, can have max TTLs, etc. For long-running automation, you often want a renewable token or Vault Agent/Proxy auto-auth.
  - Token concepts: https://developer.hashicorp.com/vault/docs/concepts/tokens
  - Auto-auth overview: https://developer.hashicorp.com/vault/docs/agent-and-proxy/autoauth

- Path parameter restriction: some APIs reject paths that end in periods (returns 404 unsupported path).
  - Source: https://developer.hashicorp.com/vault/api-docs
