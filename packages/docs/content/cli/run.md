---
title: "envi run"
description: "Run a command with the resolved vars: the environment, the signals, and the exit code."
---

# envi run

- The child gets the environment of Envi plus the resolved vars. A resolved var wins.
- Envi removes the credential variables of each provider from the child, such as
  `OP_SERVICE_ACCOUNT_TOKEN`, and every `ENVI_PROVIDER_*` variable.
- While Envi sends its spans over OTLP, the child gets `TRACEPARENT` of the span of the command.
  See [Logs and traces](./telemetry.md).
- Envi resolves and validates every var before it starts the child. A failure starts no child.
- Envi forwards `SIGTERM` and `SIGHUP` to the child, and `SIGINT` when no terminal is attached. A
  terminal sends `SIGINT` to the child on its own. Envi exits with the exit code of the child.
- When `SIGHUP`, `SIGINT`, or `SIGTERM` ends the child, Envi exits with 128 plus the number of the
  signal, as a shell does: 129, 130, or 143. Ctrl-C gives 130. Another signal gives
  `RunError KilledBySignal`.
- The arguments after `--` belong to the child. `envi run -- node app.js --json` passes `--json` to
  the child.
