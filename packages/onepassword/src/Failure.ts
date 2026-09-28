import { ProviderError, type ProviderFailure } from "@kynnyhsap/envi";

import { providerId } from "./Reference.ts";

/** A failure of the 1Password provider. The detail is safe text. It never holds an SDK message. */
export const failure = (reason: ProviderFailure, detail: string): ProviderError =>
  new ProviderError({ reason, provider: providerId, detail });
