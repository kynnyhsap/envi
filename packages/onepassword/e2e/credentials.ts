// The credentials of the tests against real 1Password. Each suite runs once for each credential
// that the environment holds, so one run tests the service account and the desktop app. An empty
// variable counts as absent.
import { type OnePasswordSettings, accountVariable, tokenVariables } from "../src/index.ts";
import {
  accountVariable as testAccountVariable,
  tokenVariable as testTokenVariable,
} from "./fixture.ts";

export const CredentialMode = {
  ServiceAccount: "service account",
  Desktop: "desktop app",
} as const;

export type CredentialMode = (typeof CredentialMode)[keyof typeof CredentialMode];

export interface TestCredential {
  readonly mode: CredentialMode;
  /** The settings of the provider in the process of the test. */
  readonly settings: OnePasswordSettings;
  /**
   * The variables of a CLI process. The desktop mode clears every token variable, so a token of
   * the shell never replaces the desktop app.
   */
  readonly env: Readonly<Record<string, string>>;
}

const present = (name: string): string | undefined => {
  const value = process.env[name]?.trim();

  return value === undefined || value === "" ? undefined : value;
};

const token = present(testTokenVariable);

const account = present(testAccountVariable);

const noToken = Object.fromEntries(tokenVariables.map((name) => [name, ""]));

/** The credentials of the environment: the service account first, then the desktop app. */
export const testCredentials: ReadonlyArray<TestCredential> = [
  ...(token === undefined
    ? []
    : [
        {
          mode: CredentialMode.ServiceAccount,
          settings: { serviceAccountToken: token },
          // `OP_SERVICE_ACCOUNT_TOKEN` is the variable that a CI system sets, so `run` must remove it.
          env: { OP_SERVICE_ACCOUNT_TOKEN: token },
        },
      ]),
  ...(account === undefined
    ? []
    : [
        {
          mode: CredentialMode.Desktop,
          settings: { account },
          env: { ...noToken, [accountVariable]: account },
        },
      ]),
];
