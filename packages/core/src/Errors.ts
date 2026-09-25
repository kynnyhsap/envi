// Every error of Envi. Each error has a reason code, a one-line summary, a hint with the next
// action, and a link to its section in the README. `hints` is the catalog: one hint for each error
// and reason. An error never holds a secret value or a rejected input.
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

/** The reasons why a provider cannot resolve one reference. */
export const ReferenceFailure = {
  NotFound: "NotFound",
  Invalid: "Invalid",
  AccessDenied: "AccessDenied",
} as const;

/** The schema of `ReferenceFailure`. */
export const ReferenceFailureSchema = Schema.Literals([
  ReferenceFailure.NotFound,
  ReferenceFailure.Invalid,
  ReferenceFailure.AccessDenied,
]);

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
export const ProviderFailureSchema = Schema.Literals([
  ProviderFailure.AuthenticationFailed,
  ProviderFailure.Unavailable,
  ProviderFailure.Misconfigured,
  ProviderFailure.UnknownProvider,
  ProviderFailure.InvalidResponse,
]);

export type ProviderFailure = typeof ProviderFailureSchema.Type;

/** The reasons why a `custom()` value fails. */
export const CustomReason = {
  /** User code threw, rejected, or failed with an error that is not a `CustomFailure`. */
  Threw: "Threw",
  /** User code failed with a `CustomFailure`. Its message is safe to show. */
  Failed: "Failed",
} as const;

/** The schema of `CustomReason`. */
export const CustomReasonSchema = Schema.Literals([CustomReason.Threw, CustomReason.Failed]);

export type CustomReason = typeof CustomReasonSchema.Type;

/** The reasons why the cache fails. */
export const CacheFailure = {
  Unreadable: "Unreadable",
  Unwritable: "Unwritable",
  KeyUnavailable: "KeyUnavailable",
  LockTimeout: "LockTimeout",
} as const;

/** The schema of `CacheFailure`. */
export const CacheFailureSchema = Schema.Literals([
  CacheFailure.Unreadable,
  CacheFailure.Unwritable,
  CacheFailure.KeyUnavailable,
  CacheFailure.LockTimeout,
]);

export type CacheFailure = typeof CacheFailureSchema.Type;

/** The reasons why `envi export --output` writes no file. */
export const ExportFileFailure = {
  NotIgnored: "NotIgnored",
  WriteFailed: "WriteFailed",
} as const;

/** The schema of `ExportFileFailure`. */
export const ExportFileFailureSchema = Schema.Literals([
  ExportFileFailure.NotIgnored,
  ExportFileFailure.WriteFailed,
]);

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
export const RunFailureSchema = Schema.Literals([
  RunFailure.CommandNotFound,
  RunFailure.CommandNotExecutable,
  RunFailure.SpawnFailed,
  RunFailure.KilledBySignal,
]);

export type RunFailure = typeof RunFailureSchema.Type;

/** The reasons why a config file does not load. */
export const ConfigLoadFailure = {
  /** An explicit config path does not exist. */
  NotFound: "NotFound",
  /** The search found no config file. */
  NoConfig: "NoConfig",
  ImportFailed: "ImportFailed",
  ConfigSyntax: "ConfigSyntax",
  /** `vars` threw while Envi evaluated it for a stage. */
  VarsThrew: "VarsThrew",
  MissingDependency: "MissingDependency",
  UnsupportedRuntime: "UnsupportedRuntime",
  InvalidConfig: "InvalidConfig",
} as const;

/** The schema of `ConfigLoadFailure`. */
export const ConfigLoadFailureSchema = Schema.Literals([
  ConfigLoadFailure.NotFound,
  ConfigLoadFailure.NoConfig,
  ConfigLoadFailure.ImportFailed,
  ConfigLoadFailure.ConfigSyntax,
  ConfigLoadFailure.VarsThrew,
  ConfigLoadFailure.MissingDependency,
  ConfigLoadFailure.UnsupportedRuntime,
  ConfigLoadFailure.InvalidConfig,
]);

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
  readonly ConfigLoadError: Readonly<Record<ConfigLoadFailure, string>>;
}

/** The catalog of hints. Each hint names the next action. The README explains each entry. */
export const hints: Catalog = {
  SecretReferenceError: {
    NotFound:
      "Check that the reference names an existing secret, and that the credential can see it. If the var may be missing, add `.optional()` or `.default(value)`.",
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
    KeyUnavailable: "Allow Envi to use the OS keychain, or turn the cache off with `--no-cache`.",
    LockTimeout:
      "Another Envi process holds the cache lock. Wait for it to finish, then run the command again.",
  },
  ExportError:
    "Export with `--format json`, or remove the characters that dotenv cannot quote from the value.",
  ExportFileError: {
    NotIgnored: "Add the file to `.gitignore` first.",
    WriteFailed: "Check that the folder of the file exists and is writable.",
  },
  SettingsError: "Fix the value of the environment variable, or unset it.",
  RunError: {
    CommandNotFound:
      "Check the command name and `PATH`. Put `--` before the command: `envi run -- bun dev`.",
    CommandNotExecutable:
      "Make the file executable with `chmod +x`, or check the permissions of the folders on `PATH`.",
    SpawnFailed: "Check the command, its arguments, and the working directory.",
    KilledBySignal:
      "A signal ended the command. Run the command without Envi to see whether it fails on its own.",
  },
  ConfigLoadError: {
    NotFound: "Check the path in `--config` or `ENVI_CONFIG`.",
    NoConfig: "Create `envi.config.ts` in the project, or pass `--config <file>`.",
    ImportFailed: "Run the config file on its own to see the error, such as `bun envi.config.ts`.",
    ConfigSyntax:
      "Fix the syntax error at the location. Run the config file on its own to see the parser message.",
    VarsThrew:
      "Fix `vars` at the location. `vars` returns literals and descriptors, and it must not throw.",
    MissingDependency:
      "Install Envi and each provider package in the project, such as `bun add -d envi`.",
    UnsupportedRuntime: "Run Envi on Node 22.19.0 or later, or on Bun.",
    InvalidConfig: "Fix the config file or the config list that the detail names.",
  },
};

/** The base of every docs link. Each error links to its section in the README. */
export const docsBase = "https://github.com/kynnyhsap/envi#";

const kebab = (text: string): string =>
  text.replaceAll(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase();

/** The README anchor of an error, such as `error-secret-reference-not-found`. */
export const anchorOf = (tag: string, reason?: string): string =>
  [
    "error",
    kebab(tag.replace(/Error$/u, "")),
    ...(reason === undefined ? [] : [kebab(reason)]),
  ].join("-");

const docsOf = (tag: string, reason?: string): string => `${docsBase}${anchorOf(tag, reason)}`;

/** The text of an error: what failed, what to do next, and where the docs explain it. */
const explain = (error: {
  readonly summary: string;
  readonly hint: string;
  readonly docs: string;
}) => `${error.summary}\n  hint: ${error.hint}\n  docs: ${error.docs}`;

/** One reference failed. `reference` holds the `describe()` text and never a secret. */
export class SecretReferenceError extends Schema.TaggedError<SecretReferenceError>()(
  "SecretReferenceError",
  {
    reason: ReferenceFailureSchema,
    provider: Schema.String,
    reference: Schema.String,
  },
) {
  get summary(): string {
    return `Envi reference failed: ${this.reason} for ${this.reference} (provider ${this.provider})`;
  }

  get hint(): string {
    return hints.SecretReferenceError[this.reason];
  }

  get docs(): string {
    return docsOf(this._tag, this.reason);
  }

  override get message(): string {
    return explain(this);
  }
}

/** A whole provider call failed. `detail` is safe text and never holds a secret. */
export class ProviderError extends Schema.TaggedError<ProviderError>()("ProviderError", {
  reason: ProviderFailureSchema,
  provider: Schema.String,
  detail: Schema.String,
}) {
  get summary(): string {
    return `Envi provider failed: ${this.reason} for provider ${this.provider}. ${this.detail}`;
  }

  get hint(): string {
    return hints.ProviderError[this.reason];
  }

  get docs(): string {
    return docsOf(this._tag, this.reason);
  }

  override get message(): string {
    return explain(this);
  }
}

/**
 * A value does not match its schema. The error names the var and the expected type from the
 * schema, and never holds the value.
 */
export class DecodeError extends Schema.TaggedError<DecodeError>()("DecodeError", {
  key: Schema.String,
  expected: Schema.String,
}) {
  get summary(): string {
    return `Envi value does not match its schema: ${this.key} expects ${this.expected}`;
  }

  get hint(): string {
    return hints.DecodeError;
  }

  get docs(): string {
    return docsOf(this._tag);
  }

  override get message(): string {
    return explain(this);
  }
}

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

const thrownText = (thrown: string | undefined, location: string | undefined): string =>
  `threw ${thrown ?? "an error"}${location === undefined ? "" : ` at ${location}`}. Envi hides the error message, because it can hold a secret`;

/**
 * A `custom()` value failed. `id` names the value. The error never holds the message of a thrown
 * error, only its class name and the location of the throw.
 */
export class CustomError extends Schema.TaggedError<CustomError>()("CustomError", {
  reason: CustomReasonSchema,
  id: Schema.String,
  /** The message of a `CustomFailure`. */
  detail: Schema.optional(Schema.String),
  /** The class name of a thrown error, such as `TypeError`. */
  thrown: Schema.optional(Schema.String),
  /** The file, line, and column of the throw in user code. */
  location: Schema.optional(Schema.String),
  transient: Schema.Boolean,
}) {
  get summary(): string {
    return this.reason === CustomReason.Failed
      ? `Envi custom("${this.id}") failed: ${this.detail ?? "no detail"}`
      : `Envi custom("${this.id}") ${thrownText(this.thrown, this.location)}`;
  }

  get hint(): string {
    return hints.CustomError[this.reason];
  }

  get docs(): string {
    return docsOf(this._tag, this.reason);
  }

  override get message(): string {
    return explain(this);
  }
}

/** A `derive()` function threw. The error never holds the message of the thrown error. */
export class DeriveError extends Schema.TaggedError<DeriveError>()("DeriveError", {
  /** The class name of the thrown error, such as `TypeError`. */
  thrown: Schema.optional(Schema.String),
  /** The file, line, and column of the throw in user code. */
  location: Schema.optional(Schema.String),
}) {
  get summary(): string {
    return `Envi derive() ${thrownText(this.thrown, this.location)}`;
  }

  get hint(): string {
    return hints.DeriveError;
  }

  get docs(): string {
    return docsOf(this._tag);
  }

  override get message(): string {
    return explain(this);
  }
}

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
export class VarsError extends Schema.TaggedError<VarsError>()("VarsError", {
  stage: Schema.String,
  /** The path of the config file, when Envi loaded the config from a file. */
  config: Schema.optional(Schema.String),
  failures: Schema.Array(VarFailureEntry),
}) {
  get summary(): string {
    const count = this.failures.length;
    const place = this.config === undefined ? "" : ` in ${this.config}`;

    return `Envi failed to resolve ${count} ${count === 1 ? "var" : "vars"} of the stage ${this.stage}${place}: ${this.failures.map((failure) => failure.key).join(", ")}`;
  }

  get hint(): string {
    return hints.VarsError;
  }

  get docs(): string {
    return docsOf(this._tag);
  }

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
export class UnknownStageError extends Schema.TaggedError<UnknownStageError>()(
  "UnknownStageError",
  {
    stage: Schema.String,
    stages: Schema.Array(Schema.String),
  },
) {
  get summary(): string {
    return `Envi stage is not declared: "${this.stage}". Declared stages: ${this.stages.join(", ")}`;
  }

  get hint(): string {
    return hints.UnknownStageError;
  }

  get docs(): string {
    return docsOf(this._tag);
  }

  override get message(): string {
    return explain(this);
  }
}

/** The cache failed as a whole. One corrupt entry is not a failure: Envi treats it as a miss. */
export class CacheError extends Schema.TaggedError<CacheError>()("CacheError", {
  reason: CacheFailureSchema,
  detail: Schema.String,
}) {
  get summary(): string {
    return `Envi cache failed: ${this.reason}. ${this.detail}`;
  }

  get hint(): string {
    return hints.CacheError[this.reason];
  }

  get docs(): string {
    return docsOf(this._tag, this.reason);
  }

  override get message(): string {
    return explain(this);
  }
}

/** An export format cannot represent the value of one var. The error never holds the value. */
export class ExportError extends Schema.TaggedError<ExportError>()("ExportError", {
  key: Schema.String,
  format: Schema.String,
}) {
  get summary(): string {
    return `Envi export cannot represent a value: ${this.key} does not fit the ${this.format} format`;
  }

  get hint(): string {
    return hints.ExportError;
  }

  get docs(): string {
    return docsOf(this._tag);
  }

  override get message(): string {
    return explain(this);
  }
}

/** Envi wrote no export file. `path` is the target file. */
export class ExportFileError extends Schema.TaggedError<ExportFileError>()("ExportFileError", {
  reason: ExportFileFailureSchema,
  path: Schema.String,
}) {
  get summary(): string {
    return this.reason === ExportFileFailure.NotIgnored
      ? `Envi export wrote no file: git does not ignore ${this.path}`
      : `Envi export wrote no file: ${this.reason} at ${this.path}`;
  }

  get hint(): string {
    return hints.ExportFileError[this.reason];
  }

  get docs(): string {
    return docsOf(this._tag, this.reason);
  }

  override get message(): string {
    return explain(this);
  }
}

/** An `ENVI_*` environment variable holds a value that Envi cannot read. */
export class SettingsError extends Schema.TaggedError<SettingsError>()("SettingsError", {
  name: Schema.String,
  expected: Schema.String,
}) {
  get summary(): string {
    return `Envi setting is not valid: ${this.name} expects ${this.expected}`;
  }

  get hint(): string {
    return hints.SettingsError;
  }

  get docs(): string {
    return docsOf(this._tag);
  }

  override get message(): string {
    return explain(this);
  }
}

/** `run` has no exit code of the child process. `command` holds the command name and no argument. */
export class RunError extends Schema.TaggedError<RunError>()("RunError", {
  reason: RunFailureSchema,
  command: Schema.String,
}) {
  get summary(): string {
    return `Envi run failed: ${this.reason} for the command "${this.command}"`;
  }

  get hint(): string {
    return hints.RunError[this.reason];
  }

  get docs(): string {
    return docsOf(this._tag, this.reason);
  }

  override get message(): string {
    return explain(this);
  }
}

/**
 * A config file failed to load, or its `vars` threw. `path` is the file path, or the directory of
 * a failed search. `location` is the file, line, and column of a syntax error or a throw.
 */
export class ConfigLoadError extends Schema.TaggedError<ConfigLoadError>()("ConfigLoadError", {
  reason: ConfigLoadFailureSchema,
  path: Schema.String,
  detail: Schema.String,
  location: Schema.optional(Schema.String),
}) {
  get summary(): string {
    return `Envi config failed to load: ${this.reason} at ${this.location ?? this.path}. ${this.detail}`;
  }

  get hint(): string {
    return hints.ConfigLoadError[this.reason];
  }

  get docs(): string {
    return docsOf(this._tag, this.reason);
  }

  override get message(): string {
    return explain(this);
  }
}

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
  ConfigLoadError,
]);

export type AnyEnviError = typeof AnyEnviErrorSchema.Type;

/** `true` for every Envi error. The CLI uses it to print each one in the same way. */
export const isEnviError = Schema.is(AnyEnviErrorSchema);

/** One entry of the catalog: the error, the reason, the hint, and the README anchor. */
export interface CatalogEntry {
  readonly error: string;
  readonly reason: string | undefined;
  readonly hint: string;
  readonly anchor: string;
}

/** Every entry of the catalog. The README has one section for each anchor. */
export const catalog: ReadonlyArray<CatalogEntry> = Object.entries(hints).flatMap(
  ([error, entry]: [string, string | Readonly<Record<string, string>>]): Array<CatalogEntry> =>
    Predicate.isString(entry)
      ? [{ error, reason: undefined, hint: entry, anchor: anchorOf(error) }]
      : Object.entries(entry).map(([reason, hint]) => ({
          error,
          reason,
          hint,
          anchor: anchorOf(error, reason),
        })),
);
