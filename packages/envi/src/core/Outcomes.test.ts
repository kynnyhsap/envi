import { describe, expect, it } from "@effect/vitest";

import {
  DecodeError,
  ProviderError,
  ProviderFailure,
  ReferenceFailure,
  SecretReferenceError,
  SettingsError,
  VarsError,
} from "./Errors.ts";
import * as Outcomes from "./Outcomes.ts";

describe("Outcomes", () => {
  it("reports an error without reasons with a null reason", () => {
    const error = new SettingsError({ name: "ENVI_STRICT", expected: "true or false" });

    expect(Outcomes.errorReport(error)).toEqual({
      error: {
        error: "SettingsError",
        reason: null,
        summary: error.summary,
        hint: error.hint,
        docs: error.docs,
      },
    });
  });

  it("reports the reason of an error with reasons", () => {
    const error = new ProviderError({
      reason: ProviderFailure.Unavailable,
      provider: "memory",
      detail: "Down.",
    });

    expect(Outcomes.errorReport(error).error.reason).toBe(ProviderFailure.Unavailable);
  });

  it("lists each failed var of a VarsError with its config, reference, and reason", () => {
    const token = new SecretReferenceError({
      reason: ReferenceFailure.NotFound,
      provider: "memory",
      reference: "memory://token",
    });

    const port = new DecodeError({ key: "PORT", expected: "a number" });

    const error = new VarsError({
      stage: "development",
      config: "/app/envi.config.ts",
      failures: [
        { key: "TOKEN", error: token },
        { key: "PORT", error: port },
      ],
    });

    expect(Outcomes.errorReport(error).error.failures).toEqual([
      {
        key: "TOKEN",
        config: "/app/envi.config.ts",
        reference: "memory://token",
        error: "SecretReferenceError",
        reason: ReferenceFailure.NotFound,
        summary: token.summary,
        hint: token.hint,
        docs: token.docs,
      },
      {
        key: "PORT",
        config: "/app/envi.config.ts",
        reference: null,
        error: "DecodeError",
        reason: "a number",
        summary: port.summary,
        hint: port.hint,
        docs: port.docs,
      },
    ]);
  });
});
