// Every error of Envi. Each error has a reason code, a one-line summary, a hint with the next
// action, and a link to its docs page. `hints` is the catalog: one hint for each error
// and reason. An error never holds a secret value or a rejected input.
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { EnviError, pageOf, ReasonError } from "./ErrorClass.ts";
import * as Package from "./Package.ts";

/** The reasons why a provider cannot resolve one reference. */
export const ReferenceFailure = {
  NotFound: "NotFound",
  Invalid: "Invalid",
  AccessDenied: "AccessDenied",
} as const;

/** The schema of `ReferenceFailure`. */
export const ReferenceFailureSchema = Schema.Enum(ReferenceFailure);

export type ReferenceFailure = typeof ReferenceFailureSchema.Type;

/** The reasons why a whole provider call fails. Only `Unavailable` allows the stale fallback. */
export const ProviderFailure = {
  AuthenticationFailed: "AuthenticationFailed",
  Unavailable: "Unavailable",
  Misconfigured: "Misconfigured",
  UnknownProvider: "UnknownProvider",
  InvalidResponse: "InvalidResponse",
} as const;

/** The schema of `ProviderFailure`. */
export const ProviderFailureSchema = Schema.Enum(ProviderFailure);

export type ProviderFailure = typeof ProviderFailureSchema.Type;

/** The reasons why a `custom()` value fails. */
export const CustomReason = {
  /** User code threw, rejected, or failed with an error that is not a `CustomFailure`. */
  Threw: "Threw",
  /** User code failed with a `CustomFailure`. Its message is safe to show. */
  Failed: "Failed",
} as const;

/** The schema of `CustomReason`. */
export const CustomReasonSchema = Schema.Enum(CustomReason);

export type CustomReason = typeof CustomReasonSchema.Type;

/** The reasons why the cache fails. */
export const CacheFailure = {
  Unreadable: "Unreadable",
  Unwritable: "Unwritable",
  KeyUnavailable: "KeyUnavailable",
  LockTimeout: "LockTimeout",
} as const;

/** The schema of `CacheFailure`. */
export const CacheFailureSchema = Schema.Enum(CacheFailure);

export type CacheFailure = typeof CacheFailureSchema.Type;

/** The reasons why `envi export --output` writes no file. */
export const ExportFileFailure = {
  WriteFailed: "WriteFailed",
} as const;

/** The schema of `ExportFileFailure`. */
export const ExportFileFailureSchema = Schema.Enum(ExportFileFailure);

export type ExportFileFailure = typeof ExportFileFailureSchema.Type;

/** The reasons why `run` cannot start the child process. */
export const RunFailure = {
  CommandNotFound: "CommandNotFound",
  /** The OS denied the start. Node also reports this for a missing command, when a `PATH` folder is not readable. */
  CommandNotExecutable: "CommandNotExecutable",
  SpawnFailed: "SpawnFailed",
  KilledBySignal: "KilledBySignal",
} as const;

/** The schema of `RunFailure`. */
export const RunFailureSchema = Schema.Enum(RunFailure);

export type RunFailure = typeof RunFailureSchema.Type;

/** The reasons why `envi docs` shows no page. */
export const DocsFailure = {
  /** No page has the name. */
  NotFound: "NotFound",
  /** The docs folder or a page cannot be read, or a page has no valid frontmatter. */
  Unreadable: "Unreadable",
} as const;

/** The schema of `DocsFailure`. */
export const DocsFailureSchema = Schema.Enum(DocsFailure);

export type DocsFailure = typeof DocsFailureSchema.Type;

/** The reasons why a config file does not load. */
export const ConfigLoadFailure = {
  /** An explicit config path does not exist. */
  NotFound: "NotFound",
  /** The search found no config file. */
  NoConfig: "NoConfig",
  /** A command that uses one config got several, from the search or from the flags. */
  ManyConfigs: "ManyConfigs",
  ImportFailed: "ImportFailed",
  ConfigSyntax: "ConfigSyntax",
  /** `vars` threw while Envi evaluated it for a stage. */
  VarsThrew: "VarsThrew",
  MissingDependency: "MissingDependency",
  UnsupportedRuntime: "UnsupportedRuntime",
  InvalidConfig: "InvalidConfig",
} as const;

/** The schema of `ConfigLoadFailure`. */
export const ConfigLoadFailureSchema = Schema.Enum(ConfigLoadFailure);

export type ConfigLoadFailure = typeof ConfigLoadFailureSchema.Type;

/** The shape of the catalog: one hint for each error, or for each reason of an error. */
interface Catalog {
  readonly SecretReferenceError: Readonly<Record<ReferenceFailure, string>>;
  readonly ProviderError: Readonly<Record<ProviderFailure, string>>;
  readonly DecodeError: string;
  readonly CustomError: Readonly<Record<CustomReason, string>>;
  readonly DeriveError: string;
  readonly VarsError: string;
  readonly UnknownStageError: string;
  readonly CacheError: Readonly<Record<CacheFailure, string>>;
  readonly ExportError: string;
  readonly ExportFileError: Readonly<Record<ExportFileFailure, string>>;
  readonly SettingsError: string;
  readonly RunError: Readonly<Record<RunFailure, string>>;
  readonly DocsError: Readonly<Record<DocsFailure, string>>;
  readonly ConfigLoadError: Readonly<Record<ConfigLoadFailure, string>>;
}

/** The catalog of hints. Each hint names the next action. A docs page explains each entry. */
export const hints: Catalog = {
  SecretReferenceError: {
    NotFound:
      "Check that the reference names an existing secret, and that the credential can see it. Run `envi find <name>` to list the references of a close name. If the var may be missing, add `.optional()` or `.default(value)`.",
    Invalid:
      "Fix the reference so that it matches the format of the provider. Run `envi inspect` to see each reference.",
    AccessDenied: "Give the credential access to the secret, or use a credential that has access.",
  },
  ProviderError: {
    AuthenticationFailed:
      "Sign in to the provider, or set a valid credential. The detail names what the provider needs.",
    Unavailable:
      "Check the network and the provider, then run the command again. Without `--strict` and outside CI, Envi uses an expired cache entry up to `maxStale`.",
    Misconfigured: "Fix the provider setting that the detail names.",
    UnknownProvider:
      "Add the provider to `providers` in the config, or fix the provider id of the descriptor.",
    InvalidResponse:
      "The provider returned a malformed answer. Update the provider package, or report the problem to its author.",
  },
  DecodeError:
    "Change the value in the provider so that it matches the schema, or change the schema of the var.",
  CustomError: {
    Threw:
      "Fix the code of `resolve` at the location. To show a safe cause, fail with `new CustomFailure({ message })`.",
    Failed:
      "Fix the cause that the message names. Pass `transient: true` to allow an expired cache entry during an outage.",
  },
  DeriveError:
    "Fix the `derive()` function at the location. Return `undefined` for a missing value instead of a throw.",
  VarsError: "Fix each failed var. Each failure has its own hint. `envi check` lists all failures.",
  UnknownStageError:
    "Pass a declared stage with `--stage` or `ENVI_STAGE`, or add the stage to `stages` in the config.",
  CacheError: {
    Unreadable:
      "Check the permissions of the cache directory, or remove the entries with `envi cache clear`.",
    Unwritable:
      "Check that the cache directory is writable, or select another one with `--cache-dir` or `ENVI_CACHE_DIR`.",
    KeyUnavailable:
      "Set ENVI_CACHE_KEY, or allow Envi to use the OS keychain (on Linux, install `secret-tool`), or turn the cache off with `--no-cache`.",
    LockTimeout:
      "Another Envi process holds the cache lock. Wait for it to finish, then run the command again.",
  },
  ExportError:
    "Export with `--format json`, or remove the characters that dotenv cannot quote from the value.",
  ExportFileError: {
    WriteFailed: "Check that the folder of the file exists and is writable.",
  },
  SettingsError: "Fix the value of the setting that the error names, or remove it.",
  RunError: {
    CommandNotFound:
      "Check the command name and `PATH`. Put `--` before the command: `envi run -- bun dev`.",
    CommandNotExecutable:
      "Make the file executable with `chmod +x`, or check the permissions of the folders on `PATH`.",
    SpawnFailed: "Check the command, its arguments, and the working directory.",
    KilledBySignal:
      "A signal such as `SIGKILL` or `SIGSEGV` ended the command. Run the command without Envi to see whether it fails on its own.",
  },
  DocsError: {
    NotFound: "Run `envi docs list` to see every page, or `envi docs search <words>` to find one.",
    Unreadable:
      "The error names the folder or the page to fix. A tool that prunes `node_modules`, a bundler, or a Dockerfile can drop the `docs` folder of Envi: keep that folder, or reinstall Envi. In the Envi repo, run `bun run build` first.",
  },
  ConfigLoadError: {
    NotFound: "Check the path in `--config` or `ENVI_CONFIG`.",
    NoConfig:
      "Create `envi.config.ts` in the project, pass `--config <file>`, or search in another direction with `--config-search`.",
    ManyConfigs:
      "Pass one `--config <file>`, or run the command in the folder of one config with `--config-search up`.",
    ImportFailed: "Run the config file on its own to see the error, such as `bun envi.config.ts`.",
    ConfigSyntax:
      "Fix the syntax error at the location. Run the config file on its own to see the parser message.",
    VarsThrew:
      "Fix `vars` at the location. `vars` returns literals and descriptors, and it must not throw.",
    MissingDependency: `Install Envi and each provider package in the project, such as \`bun add -d ${Package.name}\`.`,
    UnsupportedRuntime: `Run Envi on Node ${Package.minimumNodeVersion} or later, or on Bun ${Package.minimumBunVersion} or later.`,
    InvalidConfig: "Fix the config file or the config list that the detail names.",
  },
};

/** One reference failed. `reference` holds the `describe()` text and never a secret. */
export class SecretReferenceError extends ReasonError<SecretReferenceError>()(
  "SecretReferenceError",
  ReferenceFailureSchema,
  { provider: Schema.String, reference: Schema.String },
  {
    summary: (error) =>
      `Envi reference failed: ${error.reason} for ${error.reference} (provider ${error.provider})`,
    hints: hints.SecretReferenceError,
  },
) {}

/** A whole provider call failed. `detail` is safe text and never holds a secret. */
export class ProviderError extends ReasonError<ProviderError>()(
  "ProviderError",
  ProviderFailureSchema,
  { provider: Schema.String, detail: Schema.String },
  {
    summary: (error) =>
      `Envi provider failed: ${error.reason} for provider ${error.provider}. ${error.detail}`,
    hints: hints.ProviderError,
  },
) {}

/**
 * A value does not match its schema. The error names the var and the expected type from the
 * schema, and never holds the value.
 */
export class DecodeError extends EnviError<DecodeError>()(
  "DecodeError",
  { key: Schema.String, expected: Schema.String },
  {
    summary: (error) =>
      `Envi value does not match its schema: ${error.key} expects ${error.expected}`,
    hint: hints.DecodeError,
  },
) {}

/**
 * The failure that user code in `custom()` throws or returns to show a safe message. Envi hides
 * the message of every other error, because it can hold a secret.
 */
export class CustomFailure extends Schema.TaggedError<CustomFailure>()("CustomFailure", {
  /** Safe text. Envi shows it in errors and reports. */
  message: Schema.String,
  /** `true` lets Envi use an expired cache entry of the same inputs, like a provider outage. */
  transient: Schema.optional(Schema.Boolean),
}) {}

/** The class name and the location of a throw in user code. Envi never keeps its message. */
const throwFields = {
  /** The class name of the thrown error, such as `TypeError`. */
  thrown: Schema.optional(Schema.String),
  /** The file, line, and column of the throw in user code. */
  location: Schema.optional(Schema.String),
};

const thrownText = (error: Schema.Struct.Type<typeof throwFields>): string =>
  `threw ${error.thrown ?? "an error"}${error.location === undefined ? "" : ` at ${error.location}`}. Envi hides the error message, because it can hold a secret`;

/**
 * A `custom()` value failed. `id` names the value. The error never holds the message of a thrown
 * error, only its class name and the location of the throw.
 */
export class CustomError extends ReasonError<CustomError>()(
  "CustomError",
  CustomReasonSchema,
  {
    id: Schema.String,
    /** The message of a `CustomFailure`. */
    detail: Schema.optional(Schema.String),
    ...throwFields,
    transient: Schema.Boolean,
  },
  {
    summary: (error) =>
      error.reason === CustomReason.Failed
        ? `Envi custom("${error.id}") failed: ${error.detail ?? "no detail"}`
        : `Envi custom("${error.id}") ${thrownText(error)}`,
    hints: hints.CustomError,
  },
) {}

/** A `derive()` function threw. The error never holds the message of the thrown error. */
export class DeriveError extends EnviError<DeriveError>()("DeriveError", throwFields, {
  summary: (error) => `Envi derive() ${thrownText(error)}`,
  hint: hints.DeriveError,
}) {}

/** The schema of the failure of one var. */
export const VarErrorSchema = Schema.Union([
  SecretReferenceError,
  ProviderError,
  DecodeError,
  CustomError,
  DeriveError,
]);

/** The failure of one var. A cache failure is not one: it fails the whole operation. */
export type VarError = typeof VarErrorSchema.Type;

/** One failed var and its error. */
export const VarFailureEntry = Schema.Struct({ key: Schema.String, error: VarErrorSchema });

export type VarFailureEntry = typeof VarFailureEntry.Type;

/** One or more vars failed. The error lists every failure, not only the first one. */
export class VarsError extends EnviError<VarsError>()(
  "VarsError",
  {
    stage: Schema.String,
    /** The path of the config file, when Envi loaded the config from a file. */
    config: Schema.optional(Schema.String),
    failures: Schema.Array(VarFailureEntry),
  },
  {
    summary: (error) => {
      const count = error.failures.length;
      const place = error.config === undefined ? "" : ` in ${error.config}`;

      return `Envi failed to resolve ${count} ${count === 1 ? "var" : "vars"} of the stage ${error.stage}${place}: ${error.failures.map((failure) => failure.key).join(", ")}`;
    },
    hint: hints.VarsError,
  },
) {
  override get message(): string {
    return [
      this.summary,
      ...this.failures.map(
        ({ key, error }) =>
          `  ✗ ${key}: ${error.summary}\n    hint: ${error.hint}\n    docs: ${error.docs}`,
      ),
    ].join("\n");
  }
}

/** A stage is not in the `stages` list of the config. */
export class UnknownStageError extends EnviError<UnknownStageError>()(
  "UnknownStageError",
  { stage: Schema.String, stages: Schema.Array(Schema.String) },
  {
    summary: (error) =>
      `Envi stage is not declared: "${error.stage}". Declared stages: ${error.stages.join(", ")}`,
    hint: hints.UnknownStageError,
  },
) {}

/** The cache failed as a whole. One corrupt entry is not a failure: Envi treats it as a miss. */
export class CacheError extends ReasonError<CacheError>()(
  "CacheError",
  CacheFailureSchema,
  { detail: Schema.String },
  {
    summary: (error) => `Envi cache failed: ${error.reason}. ${error.detail}`,
    hints: hints.CacheError,
  },
) {}

/** An export format cannot represent the value of one var. The error never holds the value. */
export class ExportError extends EnviError<ExportError>()(
  "ExportError",
  { key: Schema.String, format: Schema.String },
  {
    summary: (error) =>
      `Envi export cannot represent a value: ${error.key} does not fit the ${error.format} format`,
    hint: hints.ExportError,
  },
) {}

/** Envi wrote no export file. `path` is the target file. */
export class ExportFileError extends ReasonError<ExportFileError>()(
  "ExportFileError",
  ExportFileFailureSchema,
  { path: Schema.String },
  {
    summary: (error) => `Envi export wrote no file: ${error.reason} at ${error.path}`,
    hints: hints.ExportFileError,
  },
) {}

/**
 * A setting holds a value that Envi cannot read: an `ENVI_*` variable, a config key, or an option.
 * The configs of one sync select another cache encryption or directory.
 */
export class SettingsError extends EnviError<SettingsError>()(
  "SettingsError",
  { name: Schema.String, expected: Schema.String },
  {
    summary: (error) => `Envi setting is not valid: ${error.name} expects ${error.expected}`,
    hint: hints.SettingsError,
  },
) {}

/** `run` has no exit code of the child process. `command` holds the command name and no argument. */
export class RunError extends ReasonError<RunError>()(
  "RunError",
  RunFailureSchema,
  { command: Schema.String },
  {
    summary: (error) => `Envi run failed: ${error.reason} for the command "${error.command}"`,
    hints: hints.RunError,
  },
) {}

/** `envi docs` shows no page. `page` is the page name, or the docs folder. */
export class DocsError extends ReasonError<DocsError>()(
  "DocsError",
  DocsFailureSchema,
  { page: Schema.String },
  {
    summary: (error) => `Envi docs failed: ${error.reason} for ${error.page}`,
    hints: hints.DocsError,
  },
) {}

/**
 * A config file failed to load, or its `vars` threw. `path` is the file path, or the directory of
 * a failed search. `location` is the file, line, and column of a syntax error or a throw.
 */
export class ConfigLoadError extends ReasonError<ConfigLoadError>()(
  "ConfigLoadError",
  ConfigLoadFailureSchema,
  { path: Schema.String, detail: Schema.String, location: Schema.optional(Schema.String) },
  {
    summary: (error) =>
      `Envi config failed to load: ${error.reason} at ${error.location ?? error.path}. ${error.detail}`,
    hints: hints.ConfigLoadError,
  },
) {}

/** Every error that an Envi operation can fail with. Each one has a summary, a hint, and docs. */
export const AnyEnviErrorSchema = Schema.Union([
  SecretReferenceError,
  ProviderError,
  DecodeError,
  CustomError,
  DeriveError,
  VarsError,
  UnknownStageError,
  CacheError,
  ExportError,
  ExportFileError,
  SettingsError,
  RunError,
  DocsError,
  ConfigLoadError,
]);

export type AnyEnviError = typeof AnyEnviErrorSchema.Type;

/** `true` for every Envi error. The CLI uses it to print each one in the same way. */
export const isEnviError = Schema.is(AnyEnviErrorSchema);

/** One entry of the catalog: the error, the reason, the hint, and the docs page. */
export interface CatalogEntry {
  readonly error: string;
  readonly reason: string | undefined;
  readonly hint: string;
  readonly page: string;
}

/** Every entry of the catalog. Each entry has its own docs page. */
export const catalog: ReadonlyArray<CatalogEntry> = Object.entries(hints).flatMap(
  ([error, entry]: [string, string | Readonly<Record<string, string>>]): Array<CatalogEntry> =>
    Predicate.isString(entry)
      ? [{ error, reason: undefined, hint: entry, page: pageOf(error) }]
      : Object.entries(entry).map(([reason, hint]) => ({
          error,
          reason,
          hint,
          page: pageOf(error, reason),
        })),
);
