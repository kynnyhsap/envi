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
- Non-interactive mode for CI/scripting
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

## Notes

- Envi is intentionally 1Password-only right now.
- Old provider research in `references/` is archive material, not active product direction.
