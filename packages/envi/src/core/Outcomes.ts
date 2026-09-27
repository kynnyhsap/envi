// The outcomes of a resolution: every value or one `VarsError`, and the report entry of each
// failure. A report entry never holds a value.
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";

import type * as Config from "./Config.ts";
import { type AnyEnviError, CustomReason, type VarError, VarsError } from "./Errors.ts";
import { type ErrorReport, redactedText, type VarFailure, type VarReport } from "./Reports.ts";
import type * as Resolver from "./Resolver.ts";

/** The outcome of each var, by key. */
export type Outcomes<A> = Readonly<Record<string, Result.Result<A, VarError>>>;

/** Every value in the order of the config, or one `VarsError` with every failed var. */
export const allOrVarsError = <A>(
  config: Config.Config,
  stage: string,
  outcomes: Outcomes<A>,
): Effect.Effect<ReadonlyArray<readonly [string, A]>, VarsError> => {
  const entries = Object.entries(outcomes);

  const failures = entries.flatMap(([key, outcome]) =>
    Result.isFailure(outcome) ? [{ key, error: outcome.failure }] : [],
  );

  return failures.length > 0
    ? Effect.fail(new VarsError({ stage, config: Option.getOrUndefined(config.path), failures }))
    : Effect.succeed(
        entries.flatMap(([key, outcome]) =>
          Result.isSuccess(outcome) ? [[key, outcome.success] as const] : [],
        ),
      );
};

/** The raw string of one resolved var. None for a missing optional var. */
export const rawOf = (resolved: Resolver.Resolved): Option.Option<string> =>
  Option.map(resolved.raw, Redacted.value);

/**
 * The raw string of each resolved var, without the missing optional vars. With `redact`, a secret
 * shows `redactedText`.
 */
export const rawEntries = (
  entries: ReadonlyArray<readonly [string, Resolver.Resolved]>,
  redact: boolean,
): ReadonlyArray<readonly [string, string]> =>
  entries.flatMap(([key, resolved]) =>
    Option.match(rawOf(resolved), {
      onNone: () => [],
      onSome: (raw) => [[key, redact && resolved.isRedacted ? redactedText : raw] as const],
    }),
  );

/** The `inspect` row of one var. With `redact`, a secret has no value. */
export const varReportOf = (
  key: string,
  resolved: Resolver.Resolved,
  redact: boolean,
): VarReport => {
  const redacted = redact && resolved.isRedacted;

  return {
    key,
    provider: Option.getOrNull(resolved.provider),
    reference: Option.getOrNull(resolved.reference),
    origin: resolved.origin,
    resolvedAt: Option.getOrNull(
      Option.map(resolved.resolvedAt, (millis) => new Date(millis).toISOString()),
    ),
    redacted,
    value: redacted ? null : Option.getOrNull(rawOf(resolved)),
  };
};

/** The keys of the vars that resolved. */
export const passedOf = <A>(outcomes: Outcomes<A>): ReadonlyArray<string> =>
  Object.entries(outcomes).flatMap(([key, outcome]) => (Result.isSuccess(outcome) ? [key] : []));

/** The reference text and the reason code of one failure. It never holds a value. */
const referenceAndReason = (
  error: VarError,
): { readonly reference: string | null; readonly reason: string } =>
  Match.valueTags(error, {
    DecodeError: (failure) => ({ reference: null, reason: failure.expected }),
    ProviderError: (failure) => ({ reference: null, reason: failure.reason }),
    CustomError: (failure) => ({ reference: `custom(${failure.id})`, reason: failure.reason }),
    DeriveError: () => ({ reference: null, reason: CustomReason.Threw }),
    SecretReferenceError: (failure) => ({ reference: failure.reference, reason: failure.reason }),
  });

/** The report entry of one failed var. `config` is the file of the var. */
export const failureOf = (
  key: string,
  config: Option.Option<string>,
  error: VarError,
): VarFailure => ({
  key,
  config: Option.getOrNull(config),
  ...referenceAndReason(error),
  error: error._tag,
  summary: error.summary,
  hint: error.hint,
  docs: error.docs,
});

/** The report entry of each failed var. `originOf` names the var key and the file of a key. */
export const failuresOf = <A>(
  outcomes: Outcomes<A>,
  originOf: (key: string) => { readonly key: string; readonly config: Option.Option<string> },
): ReadonlyArray<VarFailure> =>
  Object.entries(outcomes).flatMap(([key, outcome]) => {
    if (Result.isSuccess(outcome)) {
      return [];
    }

    const origin = originOf(key);

    return [failureOf(origin.key, origin.config, outcome.failure)];
  });

/** The report of a failed operation. A `VarsError` lists each failed var. */
export const errorReport = (error: AnyEnviError): ErrorReport => {
  const report = {
    error: error._tag,
    reason: "reason" in error ? error.reason : null,
    summary: error.summary,
    hint: error.hint,
    docs: error.docs,
  };

  if (!(error instanceof VarsError)) {
    return { error: report };
  }

  const config = Option.fromUndefinedOr(error.config);

  return {
    error: {
      ...report,
      failures: error.failures.map((failure) => failureOf(failure.key, config, failure.error)),
    },
  };
};
