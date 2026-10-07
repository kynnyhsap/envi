// Telemetry leaves the machine, so it holds only safe text. A span ends before Envi maps an error
// to its safe form, and a log can carry an error in its cause, its message, or its annotations. So
// the tracer and every logger replace each error: an Envi error keeps its tag and its summary, and
// any other error keeps only its name. A throw in user code or an error of the platform can hold a
// secret or an argument of a command. The tracer also drops the URL and the headers from the
// attributes of each span, event, and link, because a URL can hold a secret.
import * as Cause from "effect/Cause";
import type * as Context from "effect/Context";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Redacted from "effect/Redacted";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";

import * as Errors from "./core/Errors.ts";

/** The message of an error that Envi does not know. */
const hiddenMessage = "Envi hides the text of this error.";

const Tagged = Schema.Struct({ _tag: Schema.String });

const ErrorInstance = Schema.instanceOf(Error);

const isErrorInstance = Schema.is(ErrorInstance);

/** The text that stands in for a value inside itself. */
const circular = "[Circular]";

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

/** The text of the safe stand-in of an error. */
const safeText = (reason: Cause.Fail<unknown>) => {
  const error = safeError(reason);

  return `${error.name}: ${error.message}`;
};

/** Any value that user code passes to a log or a span. */
type Value = Logger.Options<unknown>["message"];

type Walk = (value: Value) => Value;

/** An array, or a record of plain data. An instance of a class, such as `Redacted`, is not. */
const isPlainData = (value: Value): value is Array<Value> | Readonly<Record<string, Value>> => {
  if (!Predicate.isObjectOrArray(value)) {
    return false;
  }

  const prototype: Value = Object.getPrototypeOf(value);

  return Array.isArray(value) || prototype === Object.prototype || prototype === null;
};

/** The text that stands in for a getter. Envi never runs a getter of a value. */
const getter = "[Getter]";

/** The type of a value, such as `[object Map]`. It never runs code of the value. */
const typeOf = (value: Value) => Object.prototype.toString.call(value);

/** The value of a property. Envi reads only a data property, so no getter runs. */
const propertyOf = (descriptor: PropertyDescriptor | undefined, walk: Walk): Value => {
  if (descriptor === undefined) {
    return undefined;
  }

  return "value" in descriptor ? walk(descriptor.value) : getter;
};

/**
 * New plain data with the safe form of each property. It holds only the own enumerable properties
 * with a string key, so no hook of the value, such as `toJSON`, reaches a serializer.
 */
const dataOf = (value: Array<Value> | Readonly<Record<string, Value>>, walk: Walk): Value => {
  const descriptors = Object.getOwnPropertyDescriptors(value);

  if (Array.isArray(value)) {
    return Array.from({ length: value.length }, (_, index) => propertyOf(descriptors[index], walk));
  }

  const tag = descriptors["_tag"];

  if (tag !== undefined && "value" in tag && Predicate.isString(tag.value)) {
    return safeText(Cause.makeFailReason(value));
  }

  return Object.fromEntries(
    Object.entries(descriptors).flatMap(([key, descriptor]) =>
      descriptor.enumerable === true ? [[key, propertyOf(descriptor, walk)]] : [],
    ),
  );
};

/**
 * The safe form of an object that is not plain data. Envi keeps only the objects that it knows: an
 * error shows its safe text, a cause its safe form, and Envi walks the value of an `Option`. A
 * `Redacted` stays, and a `Date` becomes a new `Date`. Any other object, and a function, shows only
 * its type, such as `[object Map]`, because it can hold an error that Envi cannot reach.
 */
const safeInstance = (value: Value, walk: Walk): Value => {
  if (isErrorInstance(value)) {
    return safeText(Cause.makeFailReason(value));
  }

  if (Cause.isCause(value)) {
    return safeCause(value);
  }

  if (Option.isOption(value)) {
    return Option.map(value, walk);
  }

  if (Predicate.isDate(value)) {
    return new Date(Date.prototype.getTime.call(value));
  }

  return Redacted.isRedacted(value) ? value : typeOf(value);
};

/**
 * A value with the safe text of each error in it, at any depth. Envi walks arrays and plain
 * records, and a plain record with a `_tag`, such as the value of `Effect.fail`, counts as an error.
 */
const safeValue: Walk = (input) => {
  const ancestors = new WeakSet<object>();

  const walk: Walk = (value) => {
    if (Predicate.isFunction(value)) {
      return typeOf(value);
    }

    if (!Predicate.isObjectOrArray(value)) {
      return value;
    }

    if (!isPlainData(value)) {
      return safeInstance(value, walk);
    }

    if (ancestors.has(value)) {
      return circular;
    }

    ancestors.add(value);
    const safe = dataOf(value, walk);
    ancestors.delete(value);

    return safe;
  };

  return walk(input);
};

/** The attributes that can hold a secret: the URL of a request, its parts, and the headers. */
const unsafeAttribute = /^(?:url\.(?:full|path|query)|http\.(?:request|response)\.header\.)/u;

/**
 * The attributes without the ones that can hold a secret, and with the safe form of each value.
 * Envi reads each value through its descriptor, so no getter runs.
 */
const safeAttributes = (attributes: Readonly<Record<string, Value>>) =>
  Object.fromEntries(
    Object.entries(Object.getOwnPropertyDescriptors(attributes)).flatMap(([key, descriptor]) =>
      descriptor.enumerable === true && !unsafeAttribute.test(key)
        ? [[key, propertyOf(descriptor, safeValue)]]
        : [],
    ),
  );

const safeLinks = (links: ReadonlyArray<Tracer.SpanLink>) =>
  links.map((link) => ({ span: link.span, attributes: safeAttributes(link.attributes) }));

const safeExit = (exit: Exit.Exit<unknown, unknown>): Exit.Exit<unknown, unknown> =>
  Exit.isSuccess(exit) ? exit : Exit.failCause(safeCause(exit.cause));

/** The span with a safe end, safe attributes, safe events, and safe links. */
const safeSpan = (opened: Tracer.Span): Tracer.Span => {
  const end = opened.end.bind(opened);
  const setAttribute = opened.attribute.bind(opened);
  const addEvent = opened.event.bind(opened);
  const addLinks = opened.addLinks.bind(opened);

  const attribute: Tracer.Span["attribute"] = (key, value) => {
    if (!unsafeAttribute.test(key)) {
      setAttribute(key, safeValue(value));
    }
  };

  const event: Tracer.Span["event"] = (name, startTime, attributes) => {
    addEvent(name, startTime, attributes === undefined ? undefined : safeAttributes(attributes));
  };

  return Object.assign(opened, {
    end: (endTime: bigint, exit: Exit.Exit<unknown, unknown>) => {
      end(endTime, safeExit(exit));
    },
    attribute,
    event,
    addLinks: (links: ReadonlyArray<Tracer.SpanLink>) => {
      addLinks(safeLinks(links));
    },
  });
};

/** A tracer whose spans hold no error text, no URL, and no header. */
export const safeTracer = (tracer: Tracer.Tracer): Tracer.Tracer => {
  const span: Tracer.Tracer["span"] = (options) =>
    safeSpan(tracer.span({ ...options, links: safeLinks(options.links) }));

  return Tracer.make(tracer.context === undefined ? { span } : { span, context: tracer.context });
};

/**
 * The fiber of a log, with safe log annotations. Each logger reads the annotations of a log from its
 * fiber, so the fiber answers that one reference with the safe value.
 */
const safeFiber = (fiber: Fiber.Fiber<unknown, unknown>): Fiber.Fiber<unknown, unknown> =>
  Object.assign(Object.create(fiber), {
    getRef: (ref: Context.Reference<Value>) =>
      ref === References.CurrentLogAnnotations
        ? Record.map(fiber.getRef(References.CurrentLogAnnotations), safeValue)
        : fiber.getRef(ref),
  });

/** A logger that receives each log with a safe cause, a safe message, and safe annotations. */
export const safeLogger = <Output>(logger: Logger.Logger<unknown, Output>) =>
  Logger.make((options) =>
    logger.log({
      ...options,
      message: safeValue(options.message),
      cause: safeCause(options.cause),
      fiber: safeFiber(options.fiber),
    }),
  );
