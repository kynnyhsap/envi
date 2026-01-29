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

### Formatting & linting

Set up oxfmt and oxlint with project configs. Add `fmt` and `lint` scripts to `package.json`.
