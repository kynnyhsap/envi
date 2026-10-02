---
title: "Known limits"
description: "The known limits of Envi and of the 1Password app."
---

# Known limits

- The 1Password app rejects parallel desktop connections from several processes. The resolve lock
  of the cache serializes them in most cases. With the cache off and desktop authentication,
  parallel `envi` processes can fail with `Unavailable`. A service account token has no such limit.
- The resolve lock of the cache is best effort. In rare cases, two processes resolve at the same
  time. This can happen when the owner of the lock stops for more than 30 seconds, such as in a
  laptop sleep, or when three processes race for the lock of a crashed process. The worst case is a
  duplicate provider call, or a desktop connection that the 1Password app rejects. The cache stays
  consistent, because Envi writes each entry atomically.
- If a folder of `PATH` is not readable, Node reports `EACCES` for a missing command. `envi run`
  then fails with `CommandNotExecutable` in place of `CommandNotFound`.
