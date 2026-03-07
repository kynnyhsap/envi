---
description: Research external secret-manager ideas and write references/<provider>.md
subtask: true
---

You are working in the Envi repo. Create (or update) a research reference document.

Inputs:
- Provider slug (lowercase, used for filename): `$1`
- Optional docs root or docs index URL: `$2`

Context:
- Envi stores provider research docs in `references/`.
- Envi is 1Password-only in production code today.
- Treat these docs as archive/research material unless the code says otherwise.

First, inspect existing references:
!`ls -la references`

Read at least these for style and integration expectations:
- @AGENTS.md
- @references/1password.md

Task:
1) Find the official documentation index for the provider. Prefer (in order):
   - an official docs index file (e.g. `llms.txt`, `sitemap.xml`, or an "API/SDK index")
   - a docs landing page with navigation
   - search the docs site if no index is available

2) Research only what is relevant to evaluating a future Envi integration:
   - CLI usage and environment variables
   - Node.js SDK usage (auth, list/get secrets)
   - Auth methods appropriate for automation (service accounts, machine identities, tokens)
   - REST API endpoints needed for secret retrieval (if SDK is insufficient)
   - Self-hosting concerns that affect integration (base URL, custom headers, proxies)
   Omit features that do not impact "resolve secret value" behavior.

3) Produce `references/$1.md` with:
   - Upstream links (product, docs, GitHub)
   - Documentation index links (include the full index URL if it exists)
   - CLI section: install, key commands, flags, env vars, examples
   - Node.js SDK section: install, client init, auth, list/get secrets, examples
   - REST API section: minimal endpoints + parameters used by Envi
   - Proposed Envi mapping (only if needed). Do not invent a provider-native URI scheme unless it is official.
   - Caveats / limitations (auth expiry, permissions, imports/references semantics, instance routing)

Constraints:
- Keep it implementation-oriented and link every claim to an upstream docs URL when possible.
- Use ASCII only.
- Do not commit. Only write/update the reference file.

If `$2` is provided, treat it as the starting point for documentation discovery.
