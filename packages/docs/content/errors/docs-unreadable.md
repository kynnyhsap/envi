---
title: "DocsError Unreadable"
description: "Envi cannot read its docs folder or a page, and GitHub does not serve the page either."
---

# DocsError Unreadable

Envi cannot read its docs folder, the folder has no index page, or a page has no valid
frontmatter. `page` names the folder or the broken page. The npm package of Envi holds the docs
in its `docs` folder. In the Envi repo, the build copies the pages into that folder.

Without a complete docs folder, `envi docs` and `envi docs show` read the page from GitHub, at the
tag of the installed version. Then this error means that GitHub did not answer, or that GitHub
served a page without valid frontmatter. `envi docs list`, `envi docs search`, and `envi docs path`
always need the folder.

Next action: The error names the folder or the page to fix. A tool that prunes `node_modules`, a bundler, or a Dockerfile can drop the `docs` folder of Envi: keep that folder, or reinstall Envi. In the Envi repo, run `bun run build` first.
