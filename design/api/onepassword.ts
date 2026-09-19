// Type-only sketch of the 1Password entry point.
import type { Provider, Source } from "envi";

export interface OpReference {
  readonly account?: string;
  readonly vault: string;
  readonly item: string;
  readonly section?: string;
  readonly field: string;
}

export interface OnePasswordSettings {
  /** Required for desktop authentication. `ENVI_PROVIDER_ONEPASSWORD_ACCOUNT` overrides it. */
  readonly account?: string;
  /**
   * Default source: `ENVI_PROVIDER_ONEPASSWORD_SERVICE_ACCOUNT_TOKEN`, then
   * `OP_SERVICE_ACCOUNT_TOKEN`. With a token, the provider never uses desktop authentication.
   */
  readonly serviceAccountToken?: string;
}

export type OpReferenceString = `op://${string}/${string}/${string}`;

export interface Op {
  (reference: OpReferenceString): Source<string>;
  (vault: string, item: string, field: string): Source<string>;
  (reference: OpReference): Source<string>;
}

/** Builds a descriptor. It imports no 1Password code. `vars` also receives it as a parameter. */
export declare const op: Op;

/** Builds the provider. It imports `@1password/sdk` lazily, on the first cache miss. */
export declare const onePasswordProvider: (
  settings?: OnePasswordSettings,
) => Provider<{ readonly op: Op }>;
