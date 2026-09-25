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

/** One reference failed. `reference` holds the `describe()` text and never a secret. */
export class ReferenceError extends Schema.TaggedError<ReferenceError>()("ReferenceError", {
  reason: ReferenceFailureSchema,
  provider: Schema.String,
  reference: Schema.String,
}) {
  override get message(): string {
    return `Envi reference failed: ${this.reason} for ${this.reference} (provider ${this.provider})`;
  }
}

/** A whole provider call failed. `detail` is safe text and never holds a secret. */
export class ProviderError extends Schema.TaggedError<ProviderError>()("ProviderError", {
  reason: ProviderFailureSchema,
  provider: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Envi provider failed: ${this.reason} for provider ${this.provider}. ${this.detail}`;
  }
}

/** A value does not match its schema. The error names the var and never holds the value. */
export class DecodeError extends Schema.TaggedError<DecodeError>()("DecodeError", {
  key: Schema.String,
  expected: Schema.String,
}) {
  override get message(): string {
    return `Envi value does not match its schema: ${this.key} expects ${this.expected}`;
  }
}

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
  override get message(): string {
    return this.reason === CustomReason.Failed
      ? `Envi custom("${this.id}") failed: ${this.detail ?? "no detail"}`
      : `Envi custom("${this.id}") ${thrownText(this.thrown, this.location)}. Throw a CustomFailure to show a safe message.`;
  }
}

/** A `derive()` function threw. The error never holds the message of the thrown error. */
export class DeriveError extends Schema.TaggedError<DeriveError>()("DeriveError", {
  /** The class name of the thrown error, such as `TypeError`. */
  thrown: Schema.optional(Schema.String),
  /** The file, line, and column of the throw in user code. */
  location: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return `Envi derive() ${thrownText(this.thrown, this.location)}.`;
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
  override get message(): string {
    return `Envi stage is not declared: "${this.stage}". Declared stages: ${this.stages.join(", ")}`;
  }
}

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

/** The cache failed as a whole. One corrupt entry is not a failure: Envi treats it as a miss. */
export class CacheError extends Schema.TaggedError<CacheError>()("CacheError", {
  reason: CacheFailureSchema,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Envi cache failed: ${this.reason}. ${this.detail}`;
  }
}

/** An export format cannot represent the value of one var. The error never holds the value. */
export class ExportError extends Schema.TaggedError<ExportError>()("ExportError", {
  key: Schema.String,
  format: Schema.String,
}) {
  override get message(): string {
    return `Envi export cannot represent a value: ${this.key} does not fit the ${this.format} format`;
  }
}

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

/** Envi wrote no export file. `path` is the target file. */
export class ExportFileError extends Schema.TaggedError<ExportFileError>()("ExportFileError", {
  reason: ExportFileFailureSchema,
  path: Schema.String,
}) {
  override get message(): string {
    return this.reason === ExportFileFailure.NotIgnored
      ? `Envi export wrote no file: git does not ignore ${this.path}. Add the file to .gitignore first.`
      : `Envi export wrote no file: ${this.reason} at ${this.path}`;
  }
}

/** An `ENVI_*` environment variable holds a value that Envi cannot read. */
export class SettingsError extends Schema.TaggedError<SettingsError>()("SettingsError", {
  name: Schema.String,
  expected: Schema.String,
}) {
  override get message(): string {
    return `Envi setting is not valid: ${this.name} expects ${this.expected}`;
  }
}

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

/** `run` has no exit code of the child process. `command` holds the command name and no argument. */
export class RunError extends Schema.TaggedError<RunError>()("RunError", {
  reason: RunFailureSchema,
  command: Schema.String,
}) {
  override get message(): string {
    return `Envi run failed: ${this.reason} for the command "${this.command}"`;
  }
}

/** The reasons why a config file does not load. */
export const ConfigLoadFailure = {
  NotFound: "NotFound",
  ImportFailed: "ImportFailed",
  MissingDependency: "MissingDependency",
  UnsupportedRuntime: "UnsupportedRuntime",
  InvalidConfig: "InvalidConfig",
} as const;

/** The schema of `ConfigLoadFailure`. */
export const ConfigLoadFailureSchema = Schema.Literals([
  ConfigLoadFailure.NotFound,
  ConfigLoadFailure.ImportFailed,
  ConfigLoadFailure.MissingDependency,
  ConfigLoadFailure.UnsupportedRuntime,
  ConfigLoadFailure.InvalidConfig,
]);

export type ConfigLoadFailure = typeof ConfigLoadFailureSchema.Type;

/** A config file failed to load. `path` is the file path, or the directory of a failed search. */
export class ConfigLoadError extends Schema.TaggedError<ConfigLoadError>()("ConfigLoadError", {
  reason: ConfigLoadFailureSchema,
  path: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Envi config failed to load: ${this.reason} at ${this.path}. ${this.detail}`;
  }
}
