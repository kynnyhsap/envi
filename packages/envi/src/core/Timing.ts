import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

/** The message of every timing line. The `step` annotation tells which step the line is for. */
export const message = "Envi finished a step.";

/** How a measured step ended. */
export const Outcome = {
  Success: "success",
  Failure: "failure",
} as const;

/** The extra fields of a timing line. A value is safe text or a count, never a secret. */
export type Annotations = Readonly<Record<string, string | number>>;

/** Logs the known duration of a step as one debug line. */
export const report = (
  step: string,
  durationMs: number,
  outcome: (typeof Outcome)[keyof typeof Outcome],
  annotations: Annotations = {},
) =>
  Effect.logDebug(message).pipe(Effect.annotateLogs({ step, durationMs, outcome, ...annotations }));

/**
 * Logs how long a step takes, as one debug line when the step ends. The line holds the `step`,
 * the `durationMs`, the `outcome`, and the given annotations. `--debug` shows the line.
 *
 * An annotation must be safe text. It never holds a secret value.
 */
export const measure =
  (step: string, annotations: Annotations = {}) =>
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
    );
