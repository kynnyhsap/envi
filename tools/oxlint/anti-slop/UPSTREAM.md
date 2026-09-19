# Upstream provenance

- Repository: https://github.com/dmmulroy/anti-slop
- Commit: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (package version `0.1.2`).
- Copied from `skills/install-anti-slop/assets/anti-slop/`, which contains upstream
  `src/` without tests.
- Entry points: `index.ts` (18 generic rules), `effect/index.ts` (5 Effect rules).
- No implementation modifications. The top-level MIT `LICENSE` and this provenance
  record are added locally. Preserve the nested Stylistic license and provenance
  under `vendor/eslint-stylistic/`.
- Runtime API: `oxlint` and `@oxlint/plugins` are both exactly `1.83.0`.
- Policy: all 23 custom rules and native `oxc/no-accumulating-spread` are errors.
  `no-runtime-typeof` uses `allowInTypeGuards: true`. The enabled policy lives in
  the root `oxlint.config.ts`.

For updates, stage incoming source separately and compare it against this exact
revision before applying changes. Preserve local changes, licenses, and policy;
update both Oxlint packages together. Run lint and review new diagnostics before
changing this baseline.
