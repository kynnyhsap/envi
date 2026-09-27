// The environment of the child process of `run`: the parent environment without the provider
// credentials, the resolved values, and the stage of the run.
import * as Settings from "./Settings.ts";

/** `run` removes every variable with this prefix from the child, because it can hold a credential. */
const providerVariablePrefix = "ENVI_PROVIDER_";

export interface Input {
  readonly parent: Readonly<Record<string, string | undefined>>;
  /** The credential variables of the providers, such as a service account token. */
  readonly credentialVariables: ReadonlyArray<string>;
  /** The raw value of each resolved var. */
  readonly values: ReadonlyArray<readonly [string, string]>;
  readonly stage: string;
}

/** The environment of the child. The stage of the run wins over a var of the same name. */
export const make = (input: Input): Record<string, string | undefined> => {
  const withheld = new Set(input.credentialVariables);

  const inherited = Object.entries(input.parent).filter(
    ([name]) => !name.startsWith(providerVariablePrefix) && !withheld.has(name),
  );

  return Object.fromEntries([...inherited, ...input.values, [Settings.stageVariable, input.stage]]);
};
