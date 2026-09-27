import { describe, expect, it } from "@effect/vitest";

import * as ChildEnvironment from "./ChildEnvironment.ts";

describe("ChildEnvironment", () => {
  const parent = {
    PATH: "/usr/bin",
    DATABASE_URL: "postgres://parent",
    ENVI_STAGE: "production",
    ENVI_PROVIDER_TOKEN: "provider credential",
    SERVICE_TOKEN: "credential",
  };

  it("keeps the parent, withholds the credentials, and adds the values and the stage", () => {
    const environment = ChildEnvironment.make({
      parent,
      credentialVariables: ["SERVICE_TOKEN"],
      values: [["DATABASE_URL", "postgres://dev"]],
      stage: "development",
    });

    expect(environment).toEqual({
      PATH: "/usr/bin",
      DATABASE_URL: "postgres://dev",
      ENVI_STAGE: "development",
    });
  });

  it("sets the stage of the run over a var of the same name", () => {
    const environment = ChildEnvironment.make({
      parent: {},
      credentialVariables: [],
      values: [["ENVI_STAGE", "other"]],
      stage: "development",
    });

    expect(environment["ENVI_STAGE"]).toBe("development");
  });
});
