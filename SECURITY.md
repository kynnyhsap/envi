# Security

Envi keeps secret values out of logs, errors, reports, and the cache files on disk. A secret value
leaves Envi only through a path that exists to deliver it:

- `envi export` without `--redact`, and the file of `envi export --output`.
- `envi inspect --no-redact`.
- The environment of the child process of `envi run`. The child can print, store, or send any value
  that it receives.
- The result of an SDK call, such as `load` or `resolve`.
- The value of a var that the config does not redact: a literal, or a var with `.redact(false)`.
  `envi inspect`, `envi export --redact`, their `--json` reports, and a schema error of the var show
  it.

The cache has the trust level of a `.env` file. Any process of the OS user can read it, a coding
agent too. Encryption protects the cache files against file reads, searches, and backups, not
against a process of the same user.

The value of a redacted var outside these paths is a vulnerability: in an error, a log, a `--json` report, a
`--debug` line, an argument, a cache file in plaintext without the opt-in, or the environment of an
unrelated process.

## Report a vulnerability

Report it in private at https://github.com/kynnyhsap/envi/security/advisories/new. Do not open a
public issue, and do not put a real secret value or a real private name in the report.

For a bug that exposes no secret, follow
[Report a problem](https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/reporting.md).
