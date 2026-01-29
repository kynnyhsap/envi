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

### Formatting & linting
Set up oxfmt and oxlint with project configs. Add `fmt` and `lint` scripts to `package.json`.
