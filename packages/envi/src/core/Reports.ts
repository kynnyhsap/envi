// The report of each command. The SDK returns a report, and the CLI prints it.
// `--json` prints the encoded report. This file holds real schemas, because every type comes from one.
import * as Schema from "effect/Schema";

import { StoreSchema } from "./Keychain.ts";

/** The indent of every JSON document that Envi prints: a report, an error, and an export. */
export const jsonIndent = 2;

/** The text that stands for a redacted value in a report and in an export. */
export const redactedText = "<redacted>";

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

export const ValueOriginSchema = Schema.Enum(ValueOrigin);

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

export type VarReport = typeof VarReport.Type;

export const InspectReport = Schema.Struct({
  stage: Schema.String,
  vars: Schema.Array(VarReport),
});

export type InspectReport = typeof InspectReport.Type;

/**
 * One failed var. `reason` is a reason code, or the expected type of a schema. `hint` names the
 * next action, and `docs` links to the docs page of the error. It never holds a value.
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
  /**
   * `true` when at least one config of the sync uses the cache. `false` when the cache is off for
   * every config, as in CI. The next run then resolves every secret again.
   */
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

/** One reference that `find` lists. */
export const FoundReference = Schema.Struct({
  provider: Schema.String,
  /** The `describe()` text of the reference. It never holds a secret. */
  reference: Schema.String,
});

/** The references of each query, in the order of the queries, and the providers without search. */
export const FindReport = Schema.Struct({
  queries: Schema.Array(
    Schema.Struct({ query: Schema.String, references: Schema.Array(FoundReference) }),
  ),
  /** The providers of the config that cannot search. */
  skipped: Schema.Array(Schema.String),
});

export type FindReport = typeof FindReport.Type;

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

/** The directory of the cache. `null` when the cache has no directory. */
export const CachePathReport = Schema.Struct({
  directory: Schema.NullOr(Schema.String),
});

export type CachePathReport = typeof CachePathReport.Type;

export const CacheClearReport = Schema.Struct({
  removed: Schema.Number,
});

export type CacheClearReport = typeof CacheClearReport.Type;

/** One docs page. `page` is its path in the docs folder without `.md`, such as `errors/vars`. */
export const DocsPage = Schema.Struct({
  page: Schema.String,
  title: Schema.String,
  description: Schema.String,
});

export type DocsPage = typeof DocsPage.Type;

/** Every docs page, in the order of its path. `folder` is the docs folder of this Envi. */
export const DocsListReport = Schema.Struct({
  folder: Schema.String,
  pages: Schema.Array(DocsPage),
});

export type DocsListReport = typeof DocsListReport.Type;

/**
 * The pages that hold every word of the query. The pages with every word in the title come first,
 * then the pages with every word in the description.
 */
export const DocsSearchReport = Schema.Struct({
  query: Schema.String,
  pages: Schema.Array(DocsPage),
});

export type DocsSearchReport = typeof DocsSearchReport.Type;

/**
 * One docs page with its Markdown text from the first heading. `path` is the file of the page, or
 * its URL on GitHub when the docs folder is missing.
 */
export const DocsPageReport = Schema.Struct({
  ...DocsPage.fields,
  path: Schema.String,
  text: Schema.String,
});

export type DocsPageReport = typeof DocsPageReport.Type;

/** The docs folder, or the file of one page. */
export const DocsPathReport = Schema.Struct({
  path: Schema.String,
});

export type DocsPathReport = typeof DocsPathReport.Type;

/** The runtimes of Envi. */
export const RuntimeName = {
  Node: "node",
  Bun: "bun",
} as const;

export const RuntimeNameSchema = Schema.Enum(RuntimeName);

export type RuntimeName = typeof RuntimeNameSchema.Type;

/**
 * The facts of a setup that a public issue can hold. `envi doctor` imports no config and reads
 * no secret, so it holds no path, no reference, and no value of a variable.
 */
export const DoctorReport = Schema.Struct({
  version: Schema.String,
  runtime: Schema.Struct({ name: RuntimeNameSchema, version: Schema.String }),
  platform: Schema.String,
  arch: Schema.String,
  /** `CI` is set. The default cache is off in CI, and a prompt is forbidden. */
  ci: Schema.Boolean,
  /** The config files of a search up from here and of the whole repo. Envi does not import them. */
  configs: Schema.Struct({ up: Schema.Number, repo: Schema.Number }),
  /** A cache directory is selected without a config: `ENVI_CACHE_DIR`, or the default in `HOME`. */
  cacheDirectory: Schema.Boolean,
  /**
   * The keychain of the platform, and whether its command is on `PATH`. `command` is `null` when
   * the platform has no keychain. Envi does not read the keychain, so it never shows a prompt.
   */
  keychain: Schema.Struct({ store: StoreSchema, command: Schema.NullOr(Schema.Boolean) }),
  /** The names of the `ENVI_*` variables that are set, sorted. A value can be private. */
  variables: Schema.Array(Schema.String),
});

export type DoctorReport = typeof DoctorReport.Type;

/** The formats of `export`. */
export const ExportFormat = {
  Dotenv: "dotenv",
  Json: "json",
} as const;

/** The schema of `ExportFormat`. The CLI decodes `--format` with it. */
export const ExportFormatSchema = Schema.Enum(ExportFormat);

export type ExportFormat = typeof ExportFormatSchema.Type;
