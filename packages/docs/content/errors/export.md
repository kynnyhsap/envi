---
title: "ExportError"
description: "An export format cannot represent one var: a value that dotenv cannot quote, or a name that `GITHUB_ENV` cannot hold."
---

# ExportError

An export format cannot represent one var. The error names the var and the format, and never the
value.

- `dotenv`: a value holds characters that the dotenv format cannot quote safely.
- `github`: a var name holds characters other than letters, digits, and `_`, or starts with a
  digit. A name with `=`, `<<`, or a line break would corrupt the file of `GITHUB_ENV`. Envi checks
  the names before it prints a mask or writes the file.

Next action: Export with `--format json`. For `dotenv`, remove the characters that dotenv cannot quote from the value. For `github`, name the var with letters, digits, and `_`, not first a digit.
