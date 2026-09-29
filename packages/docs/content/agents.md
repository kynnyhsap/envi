---
title: "Coding agents"
description: "Give a coding agent the Envi skills, the docs of the installed version, and the rules for secrets."
---

# Coding agents

A coding agent works with Envi through the same CLI as a user. The Envi package gives it two
things for the installed version: the docs, and two agent skills.

## Skills

| Skill        | Use                                                                                     |
| ------------ | --------------------------------------------------------------------------------------- |
| `envi`       | Run commands with the vars, change a var, fix an error, and keep secret values private. |
| `envi-setup` | Add Envi to a project: install it, write `envi.config.ts`, and move the secrets.        |

Install them with the [skills](https://github.com/vercel-labs/skills) CLI, from GitHub or from the
installed package:

```sh
npx skills add kynnyhsap/envi
npx skills add ./node_modules/@kynnyhsap/envi
```

The package holds the skills in its `skills` folder. Each skill is thin: it points the agent at
`envi docs`, so the details always match the installed version.

## Docs

`envi docs` reads the docs of the installed version offline. See [envi docs](./cli/docs.md). An
agent can also read the `docs` folder of the package with its own tools.

## AGENTS.md

Envi never writes a file of your project. To point every agent at the docs, add a block such as
this one to your `AGENTS.md` or `CLAUDE.md`:

```md
## Envi

This project loads its env with Envi. Before you change `envi.config.ts` or the env setup, run
`envi docs` and read the page of the task. To read the page of an error, run
`envi docs show <docs link>`. Never print a secret value.
```

## Secrets and the cache

The cache has the trust level of a `.env` file: any process of the OS user can read it, an agent
too. Without a service account token, the 1Password provider asks for an approval in the
1Password app. To give an agent the vars without a prompt, run `envi sync` in your terminal
first, or give the agent a service account token that sees only the vaults it needs.
