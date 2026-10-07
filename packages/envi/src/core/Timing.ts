import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

/** The message of every timing line. The `step` annotation tells which step the line is for. */
export const message = "Envi finished a step.";

/**
 * The steps that `--debug` times, and the names of their spans. A provider names its own steps,
 * such as `onepassword.client`.
 */
export const Step = {
  Startup: "startup",
  Command: "command",
  ConfigImport: "config.import",
  KeychainKey: "keychain.key",
  CacheRead: "cache.read",
  ResolveLock: "resolve.lock",
  ProviderResolve: "provider.resolve",
  CustomResolve: "custom.resolve",
  CacheWrite: "cache.write",
  RunChild: "run.child",
} as const;

/** How a measured step ended. */
export const Outcome = {
  Success: "success",
  Failure: "failure",
} as const;

/** The schema of `Outcome`. */
export const OutcomeSchema = Schema.Enum(Outcome);

export type Outcome = typeof OutcomeSchema.Type;

/** The extra fields of a timing line. A value is safe text or a count, never a secret. */
export type Annotations = Readonly<Record<string, string | number>>;

/** Logs the known duration of a step as one debug line. */
export const report = (
  step: string,
  durationMs: number,
  outcome: Outcome,
  annotations: Annotations = {},
) =>
  Effect.logDebug(message).pipe(Effect.annotateLogs({ step, durationMs, outcome, ...annotations }));

/**
 * Runs a step in a span, and logs how long the step takes, as one debug line when the step ends.
 * The span holds the annotations as attributes. The line holds the `step`, the `durationMs`, the
 * `outcome`, and the annotations. `--debug` shows the line, and an OTLP export sends both.
 *
 * An annotation must be safe text. It never holds a secret value.
 *
 * @param span - The name of the span. Default: the step.
 */
export const measure =
  (step: string, annotations: Annotations = {}, span: string = step) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.flatMap(Clock.currentTimeMillis, (start) =>
      Effect.onExit(self, (exit) =>
        Effect.flatMap(Clock.currentTimeMillis, (end) =>
          report(
            step,
            end - start,
            Exit.isSuccess(exit) ? Outcome.Success : Outcome.Failure,
            annotations,
          ),
        ),
      ),
    ).pipe(Effect.withSpan(span, { attributes: annotations }));
