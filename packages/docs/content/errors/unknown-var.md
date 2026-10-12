---
title: "UnknownVarError"
description: "`envi export --only` names a var that the stage does not declare."
---

# UnknownVarError

`envi export --only`, or the `only` option of `export`, names a var that the stage does not
declare. The error names the stage and each missing name. Envi checks the names before it resolves
anything, so the export calls no provider and writes nothing.

Next action: Pass only the vars of the stage to `--only` or `only`. Run `envi inspect --stage <stage>` to list them.
