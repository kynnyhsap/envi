// The environment of the child process of `run`: the parent environment without the provider
// credentials, the trace context of the run, the resolved values, and the stage of the run.
import * as Settings from "./Settings.ts";
import * as TraceContext from "./TraceContext.ts";

/** `run` removes every variable with this prefix from the child, because it can hold a credential. */
const providerVariablePrefix = "ENVI_PROVIDER_";

export interface Input {
  readonly parent: Readonly<Record<string, string | undefined>>;
  /** The credential variables of the providers, such as a service account token. */
  readonly credentialVariables: ReadonlyArray<string>;
  /** The raw value of each resolved var. */
  readonly values: ReadonlyArray<readonly [string, string]>;
  readonly stage: string;
  /** The trace context of the run. It replaces the `TRACEPARENT` of the parent. */
  readonly traceParent?: string | undefined;
}

/**
 * The environment of the child. A var wins over the trace context, and the stage of the run wins
 * over a var of the same name.
 */
export const make = (input: Input): Record<string, string | undefined> => {
  const withheld = new Set(input.credentialVariables);

  const inherited = Object.entries(input.parent).filter(
    ([name]) => !name.startsWith(providerVariablePrefix) && !withheld.has(name),
  );

  const traceParent =
    input.traceParent === undefined ? [] : [[TraceContext.variable, input.traceParent]];

  return Object.fromEntries([
    ...inherited,
    ...traceParent,
    ...input.values,
    [Settings.stageVariable, input.stage],
  ]);
};
