---
title: "envi docs"
description: "Read the docs of the installed Envi offline: the index, one page, a search, or a path."
---

# envi docs

The npm package of Envi holds these docs in its `docs` folder. `envi docs` reads that folder, so
it shows the docs of the installed version, and it needs no network and no config.

| Command                    | Does                                                           |
| -------------------------- | -------------------------------------------------------------- |
| `envi docs`                | Prints the index page, which maps each task to a page.         |
| `envi docs list`           | Lists every page with its description.                         |
| `envi docs show <page>`    | Prints one page as Markdown.                                   |
| `envi docs search <words>` | Lists the pages that hold every word, the title matches first. |
| `envi docs path [page]`    | Prints the docs folder, or the file of one page.               |

A page name is the path of the page in the docs folder without `.md`, such as `cache` or
`errors/vars`. `show` and `path` also take the file name, such as `errors/vars.md`, and the docs
link of an error:

```sh
envi docs show https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/errors/vars.md
```

Each subcommand takes `--json`. `list` prints `{ folder, pages }`, `search` prints
`{ query, pages }`, `show` prints `{ page, title, description, path, text }`, and `path` prints
`{ path }`. Each entry of `pages` holds `page`, `title`, and `description`.

An agent can also read the folder with its own tools. `envi docs path` prints the folder, and
`require.resolve("@kynnyhsap/envi/package.json")` finds the package.

[Coding agents](../agents.md) shows how to point an agent at these docs.

A name that no page has fails with [DocsError NotFound](../errors/docs-not-found.md).
