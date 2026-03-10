# Examples

These are the only examples worth keeping around right now:

- `1password-basic/` - one app, one vault, a few `op://` references
- `1password-monorepo/` - multiple packages with auto-discovered `.env.example` files
- `1password-environments/` - `${PROFILE}` substitution to switch item names inside one vault
- `custom-files/` - custom template/output filenames via flags or `envi.json`
- `1password-e2e-bench/` - live benchmark harness against a real 1Password vault

Everything here is 1Password-only and matches the current codebase.

To make the examples runnable in this repo, seed the shared example vaults first:

```bash
bun run examples:setup
```

Clean them up when you're done:

```bash
bun run examples:cleanup
```
