---
title: "envi find"
description: "Find the reference of a secret by the name of its item, without a value."
---

# envi find

`envi find` lists the references whose names match each query. It returns no value and logs no
value, so it is safe for a coding agent that writes a config. Paste a reference into `op()`.

```sh
envi find stripe postgres
envi find op://app/postgress/url
envi find stripe --json
```

```text
stripe
  op://payments/stripe/secret-key
  op://payments/stripe/publishable-key
postgres
  op://app/postgres/url
```

- A query is a name, such as `stripe`, or a reference with a typo, such as
  `op://app/postgress/url`.
- `find` uses the providers of the config, so it needs a config. It searches every provider that
  can search, and lists the others under `skipped`. A provider of a [custom
  provider](../sdk/custom-providers.md) can search through `discover`.
- `find` makes one search call for each provider, with every query. It never uses the cache.
- A query without a match shows `no match`. `find` still exits with 0.

| Flag                                | Does                                                              |
| ----------------------------------- | ----------------------------------------------------------------- |
| `--config <file>`                   | Selects the config file.                                          |
| `--config-search <direction>`       | `up`, `down`, or `repo`. See [Config search](./config-search.md). |
| `--interactive`, `--no-interactive` | Allows or forbids a prompt, such as a desktop app approval.       |
| `--json`                            | Prints the report, or the error, as JSON on stdout.               |

The `--json` report has `queries`, with the `query` and its `references`, each with its
`provider` and its `reference` text, and `skipped`, the providers that cannot search.

## 1Password

The 1Password SDK has no search. The provider lists the vaults, the items of each vault, and the
fields of each item that matches. It makes one call for the vaults, one call for each vault, and
one call for each vault that holds a match, with 50 items at most a call. It decodes each answer without its values.

- A query matches an item whose title holds the query, or a title that differs by a few letters.
  Case does not matter. A query lists at most 10 items, the closest first.
- For a reference query, the provider compares the item, then the vault, and lists the closest
  field first.
- A reference names a vault, an item, a section, or a field by its title. A title with `/` or `?`,
  or a title that another vault, item, section, or field of the same parent shares, gives its ID.
- Without a token, the search uses the desktop app and needs `account` and an interactive run, as
  a resolve does. See [1Password](../providers/1password.md).
- A service account lists only the vaults that it can read.
