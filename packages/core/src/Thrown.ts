// What Envi may show about a value that user code threw: the class name and the place of the
// throw. The message never appears, because it can hold a secret.
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** Parses a thrown value at the boundary of user code. Only an `Error` has a name and a stack. */
export const asError = Schema.decodeUnknownOption(Schema.instanceOf(Error));

/**
 * One frame of a V8 or a JavaScriptCore stack: an absolute path or a file URL, a line, a column.
 * The path starts the line or follows a space, `(`, or `@`, so `node:internal/...` never matches.
 */
const stackFrame = /(?:^|[\s(@])((?:file:\/\/)?\/[^\s()]+?):(\d+)(?::(\d+))?\)?$/u;

/** The first frame of a stack outside `node_modules`: the place in user code that threw. */
export const locationOf = (stack: string): string | undefined =>
  stack
    .split("\n")
    .flatMap((line) => {
      const match = stackFrame.exec(line.trim());

      if (match === null || match[1] === undefined) {
        return [];
      }

      const file = match[1].replace(/^file:\/\//u, "").replace(/\?.*$/u, "");
      const column = match[3] === undefined ? "" : `:${match[3]}`;

      return file.includes("/node_modules/") ? [] : [`${file}:${match[2]}${column}`];
    })
    .at(0);

/** The class name of an error, or a neutral text for a name that could hold anything. */
export const nameOf = (error: Error): string =>
  /^[\w$.]{1,64}$/u.test(error.name) ? error.name : "an Error";

/** The class name and the location of a thrown value. They never hold the message. */
export const describe = (
  thrown: Option.Option<Error>,
): { readonly thrown: string; readonly location: string | undefined } =>
  Option.match(thrown, {
    onNone: () => ({ thrown: "a value that is not an Error", location: undefined }),
    onSome: (error) => ({ thrown: nameOf(error), location: locationOf(error.stack ?? "") }),
  });
