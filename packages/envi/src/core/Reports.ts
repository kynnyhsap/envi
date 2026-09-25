// The report of each command. The SDK returns a report, and the CLI prints it.
// `--json` prints the encoded report. This file holds real schemas, because every type comes from one.
import * as Schema from "effect/Schema";

/** Where the value of one var comes from. */
export const ValueOrigin = {
  Literal: "literal",
  Environment: "environment",
  Cache: "cache",
  StaleCache: "stale-cache",
  Provider: "provider",
  Derived: "derived",
  Custom: "custom",
  Default: "default",
  Unset: "unset",
} as const;

export const ValueOriginSchema = Schema.Literals([
  ValueOrigin.Literal,
  ValueOrigin.Environment,
  ValueOrigin.Cache,
  ValueOrigin.StaleCache,
  ValueOrigin.Provider,
  ValueOrigin.Derived,
  ValueOrigin.Custom,
  ValueOrigin.Default,
  ValueOrigin.Unset,
]);

export type ValueOrigin = typeof ValueOriginSchema.Type;

/** One var of `inspect`. `value` is `null` when the var is redacted or unset. */
export const VarReport = Schema.Struct({
  key: Schema.String,
  provider: Schema.NullOr(Schema.String),
  /** The `describe()` text of the reference. It never holds a secret. */
  reference: Schema.NullOr(Schema.String),
  origin: ValueOriginSchema,
  resolvedAt: Schema.NullOr(Schema.String),
  redacted: Schema.Boolean,
  value: Schema.NullOr(Schema.String),
});

export const InspectReport = Schema.Struct({
  stage: Schema.String,
  vars: Schema.Array(VarReport),
});

export type InspectReport = typeof InspectReport.Type;

/**
 * One failed var. `reason` is a reason code, or the expected type of a schema. `hint` names the
 * next action, and `docs` links to the section of the error in the README. It never holds a value.
 */
export const VarFailure = Schema.Struct({
  key: Schema.String,
  /** The config file of the var, when Envi loaded the config from a file. */
  config: Schema.NullOr(Schema.String),
  reference: Schema.NullOr(Schema.String),
  error: Schema.String,
  reason: Schema.String,
  summary: Schema.String,
  hint: Schema.String,
  docs: Schema.String,
});

export type VarFailure = typeof VarFailure.Type;

export const SyncReport = Schema.Struct({
  stage: Schema.String,
  configs: Schema.Number,
  providers: Schema.Array(
    Schema.Struct({
      provider: Schema.String,
      secrets: Schema.Number,
      cached: Schema.Number,
      resolved: Schema.Number,
    }),
  ),
  failures: Schema.Array(VarFailure),
  /** `false` when the cache is off, as in CI. The next run then resolves every secret again. */
  cache: Schema.Boolean,
  durationMillis: Schema.Number,
});

export type SyncReport = typeof SyncReport.Type;

export const CheckReport = Schema.Struct({
  stage: Schema.String,
  passed: Schema.Array(Schema.String),
  failures: Schema.Array(VarFailure),
});

export type CheckReport = typeof CheckReport.Type;

export const RunReport = Schema.Struct({
  exitCode: Schema.Number,
});

export type RunReport = typeof RunReport.Type;

/**
 * One cache entry. It has no expiry, because each reader applies the ttl of its own config to
 * `resolvedAt`.
 */
export const CacheEntryReport = Schema.Struct({
  provider: Schema.String,
  reference: Schema.String,
  resolvedAt: Schema.String,
});

export const CacheListReport = Schema.Struct({
  /** The directory of a file cache. `null` for a cache without files. */
  directory: Schema.NullOr(Schema.String),
  entries: Schema.Array(CacheEntryReport),
});

export type CacheListReport = typeof CacheListReport.Type;

/**
 * An operation failed. `--json` prints it on stdout. `failures` lists each failed var of a
 * `VarsError`. `reason` is null for an error without reasons.
 */
export const ErrorReport = Schema.Struct({
  error: Schema.Struct({
    error: Schema.String,
    reason: Schema.NullOr(Schema.String),
    summary: Schema.String,
    hint: Schema.String,
    docs: Schema.String,
    failures: Schema.optional(Schema.Array(VarFailure)),
  }),
});

export type ErrorReport = typeof ErrorReport.Type;

export const CacheClearReport = Schema.Struct({
  removed: Schema.Number,
});

export type CacheClearReport = typeof CacheClearReport.Type;

/** The formats of `export`. */
export const ExportFormat = {
  Dotenv: "dotenv",
  Json: "json",
} as const;

/** The schema of `ExportFormat`. The CLI decodes `--format` with it. */
export const ExportFormatSchema = Schema.Literals([ExportFormat.Dotenv, ExportFormat.Json]);

export type ExportFormat = typeof ExportFormatSchema.Type;
