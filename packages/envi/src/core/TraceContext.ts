// The trace context that Envi passes to a child process. The variable `TRACEPARENT` holds it in
// the W3C `traceparent` format, so a child that reads it continues the trace of Envi.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpTraceContext from "effect/http/HttpTraceContext";
import * as Option from "effect/Option";

/** The variable of the trace context. */
export const variable = "TRACEPARENT";

/**
 * `true` when Envi exports its spans. Only then does a child find the parent span of its trace, so
 * only then does Envi replace the `TRACEPARENT` of its own parent. The CLI sets it.
 */
export const Propagate = Context.Reference<boolean>("envi/TraceContext/Propagate", {
  defaultValue: () => false,
});

/** The trace context of the current span, while Envi exports its spans. */
export const current: Effect.Effect<Option.Option<string>> = Effect.flatMap(
  Propagate,
  (propagate) =>
    propagate
      ? Effect.map(
          Effect.option(Effect.currentSpan),
          Option.flatMap((span) =>
            Option.fromUndefinedOr(HttpTraceContext.toHeaders(span)[variable.toLowerCase()]),
          ),
        )
      : Effect.succeedNone,
);
