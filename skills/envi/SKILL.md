---
name: "envi"
description: "Work in a project that loads its env with Envi: an envi.config.ts file, the envi command, or the @kynnyhsap/envi package. Use it to run a command with the vars, add or change a var, select a stage, refresh the cache, fix an Envi error, or read the Envi docs. It keeps secret values out of the chat."
---

# Envi

Envi resolves the env of a project from a secret provider, caches it, and injects it into a
command. Each package that needs env has an `envi.config.ts`. Its `vars` function maps each var
to a literal or to a reference, such as `op("app", "postgres", "url")` for 1Password.

Run `envi` through the package manager of the project, such as `bunx envi` or `npx envi`, when it
is not on `PATH`.

## Read the docs of the installed version

The Envi package ships its docs, and `envi docs` reads them offline. Trust these docs over what
you remember, because they match the installed version.

| Need                                      | Command                    |
| ----------------------------------------- | -------------------------- |
| The index, which maps each task to a page | `envi docs`                |
| A page for your words                     | `envi docs search <words>` |
| One page                                  | `envi docs show <page>`    |
| The folder, to read it with your tools    | `envi docs path`           |

## Keep secrets out of the chat

- Never print a secret value. `envi export` prints the real values by default, so run it only
  with `--redact`. Do not run `envi inspect --no-redact`, and do not print the env inside
  `envi run`, such as with `printenv` or `env`.
- To learn about the vars, use `envi check`, which shows no value, and `envi inspect`, which hides
  secrets.
- Never write a secret value into a file, a commit, or a message. Put a reference into
  `envi.config.ts` instead. Only when the user asks for an env file, run
  `envi export --output <file>` with a path outside the repo.

## Common tasks

| Task                            | Command                                    |
| ------------------------------- | ------------------------------------------ |
| Run a command with the vars     | `envi run -- <command>`                    |
| Check that every var resolves   | `envi check`                               |
| See where each var comes from   | `envi inspect`                             |
| Fill the cache for every config | `envi sync` at the repo root               |
| Resolve every secret again      | `envi sync --refresh`                      |
| Use another stage               | `envi run --stage production -- <command>` |

A flag follows its command, and the flags of `envi run` come before `--`.

## Change a var

1. Read `envi docs show config/sources` for the sources, the schemas, and `.optional()` and
   `.default()`.
2. Change `vars` in `envi.config.ts`. `vars` returns only literals and descriptors, and it does
   no I/O.
3. Run `envi check`.

Ask the user for the vault, the item, and the field of a new secret. Do not read secret values to
find a reference.

## Fix an error

Each Envi error has a summary, a hint, and a docs link. Follow the hint first. For more, run
`envi docs show <docs link>`. With `--json`, a command prints the error as JSON on stdout.

Without a service account token, the 1Password provider asks for an approval in the 1Password
app. If a command waits, tell the user to approve it in the app, or to run `envi sync` in their
own terminal. After that, the cache serves the next runs.
