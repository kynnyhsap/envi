---
title: "Report a problem"
description: "Report a bug in a public issue without a secret or a private name, and report a vulnerability in private."
---

# Report a problem

## A vulnerability

The value of a redacted var in an error, a log, a `--json` report, a `--debug` line, or a
plaintext cache file without the opt-in is a vulnerability. Report it in private at
https://github.com/kynnyhsap/envi/security/advisories/new, not in a public issue.
[SECURITY.md](https://github.com/kynnyhsap/envi/blob/main/SECURITY.md) lists the paths that show
values on purpose.

## A bug

An issue is public. It can never hold a secret value, and it must not hold a private name.

1. Search the issues first. If an issue already covers the problem, add to it:

   ```sh
   gh issue list --repo kynnyhsap/envi --state all --search "<words>"
   ```

2. Collect the facts: the output of `envi --version`, the OS, the runtime and its version, the
   command, what you expected, and what happened. For an error, add its tag, its reason, and its
   `docs` link.
3. Remove each value, and replace each private name with a placeholder before you post. The
   errors and the `--debug` logs show no value of a redacted var, but they show references and
   paths. `envi inspect`, `envi export --redact`, and a schema error show the value of a var that
   the config does not redact: a literal, or a var with `.redact(false)`. Remove these values.
   Replace the account, the vaults, the items, the sections, the fields, each `op://` reference,
   the project name, and the paths. Use generic names, such as the account `my-team`, the vault
   `app`, the item `postgres`, and the field `url`.
4. Post the issue:

   ```sh
   gh issue create --repo kynnyhsap/envi --title "<what went wrong>" --body "<details>"
   ```

A coding agent shows the text to the user and asks before it posts, because the issue is public and
it posts from the account of the user.
