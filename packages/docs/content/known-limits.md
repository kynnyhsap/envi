---
title: "Known limits"
description: "The known limits of Envi and of the 1Password app."
---

# Known limits

- The 1Password app rejects parallel desktop connections from several processes. The resolve lock
  of the cache serializes them. With the cache off and desktop authentication, parallel `envi`
  processes can fail with `Unavailable`. A service account token has no such limit.
- If a folder of `PATH` is not readable, Node reports `EACCES` for a missing command. `envi run`
  then fails with `CommandNotExecutable` in place of `CommandNotFound`.
