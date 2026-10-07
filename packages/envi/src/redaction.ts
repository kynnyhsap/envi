// Telemetry leaves the machine, so it holds only safe text. A span ends before Envi maps an error
// to its safe form, and a log can carry an error in its cause or in its message. So the tracer and
// every logger replace each error: an Envi error keeps its tag and its summary, and any other error
// keeps only its name. A throw in user code or an error of the platform can hold a secret or an
// argument of a command. The tracer also drops the URL and the headers of an HTTP span, because a
// URL can hold a secret.
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";

import * as Errors from "./core/Errors.ts";

/** The message of an error that Envi does not know. */
const hiddenMessage = "Envi hides the text of this error.";

const Tagged = Schema.Struct({ _tag: Schema.String });

const ErrorInstance = Schema.instanceOf(Error);

/** A value of a log message that Envi replaces: an `Error` or a tagged error. */
const isError = Schema.is(Schema.Union([ErrorInstance, Tagged]));

/** The error of a failure or the defect of a death. */
const errorOf = (reason: Cause.Fail<unknown> | Cause.Die) =>
  Cause.isFailReason(reason) ? reason.error : reason.defect;

/**
 * A safe stand-in for one error: its tag or its class name, and a safe message, with no stack frame
 * and no cause. Only an Envi error keeps its summary.
 */
const safeError = (reason: Cause.Fail<unknown> | Cause.Die) => {
  const error = errorOf(reason);

  const name = Schema.decodeUnknownOption(Tagged)(error).pipe(
    Option.map((tagged) => tagged._tag),
    Option.orElse(() =>
      Option.map(Schema.decodeUnknownOption(ErrorInstance)(error), (instance) => instance.name),
    ),
    Option.getOrElse(() => "Error"),
  );

  const message = Errors.isEnviError(error) ? error.summary : hiddenMessage;

  return { name, message, stack: `${name}: ${message}` };
};

/** The cause with a safe stand-in for each error. An interruption stays. */
export const safeCause = (cause: Cause.Cause<unknown>): Cause.Cause<unknown> =>
  Cause.fromReasons(
    cause.reasons.map((reason) => {
      if (Cause.isFailReason(reason)) {
        return Cause.makeFailReason(safeError(reason));
      }

      return Cause.isDieReason(reason) ? Cause.makeDieReason(safeError(reason)) : reason;
    }),
  );

/** The text of the safe stand-in of an error in a log message. */
const safeText = (reason: Cause.Fail<unknown>) => {
  const error = safeError(reason);

  return `${error.name}: ${error.message}`;
};

/** A log message with the safe text of each error in it. `Effect.log` passes several values as an array. */
const safeMessage = (message: Logger.Options<unknown>["message"]) =>
  Array.isArray(message)
    ? message.map((part) => (isError(part) ? safeText(Cause.makeFailReason(part)) : part))
    : message;

/** The attributes of an HTTP span that can hold a secret: the URL, its parts, and the headers. */
const unsafeAttribute = /^(?:url\.(?:full|path|query)|http\.(?:request|response)\.header\.)/u;

const safeExit = (exit: Exit.Exit<unknown, unknown>): Exit.Exit<unknown, unknown> =>
  Exit.isSuccess(exit) ? exit : Exit.failCause(safeCause(exit.cause));

/**
 * A tracer that ends each span with a safe cause, so its status and its events hold no secret. It
 * drops the attributes of an HTTP span that can hold a secret.
 */
export const safeTracer = (tracer: Tracer.Tracer): Tracer.Tracer => {
  const span: Tracer.Tracer["span"] = (options) => {
    const opened = tracer.span(options);
    const end = opened.end.bind(opened);
    const setAttribute = opened.attribute.bind(opened);

    const attribute: Tracer.Span["attribute"] = (key, value) => {
      if (!unsafeAttribute.test(key)) {
        setAttribute(key, value);
      }
    };

    return Object.assign(opened, {
      end: (endTime: bigint, exit: Exit.Exit<unknown, unknown>) => {
        end(endTime, safeExit(exit));
      },
      attribute,
    });
  };

  return Tracer.make(tracer.context === undefined ? { span } : { span, context: tracer.context });
};

/** A logger that receives each log with a safe cause and a safe message. */
export const safeLogger = <Output>(logger: Logger.Logger<unknown, Output>) =>
  Logger.make((options) =>
    logger.log({
      ...options,
      message: safeMessage(options.message),
      cause: safeCause(options.cause),
    }),
  );
