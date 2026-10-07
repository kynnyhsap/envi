// `envi find`: the references of each query, as text and as JSON, without a value and without a
// resolve call.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import { FindReport } from "@kynnyhsap/envi";
import * as Effect from "effect/Effect";

import { fileProviderId } from "./fixtures/file-provider.ts";
import {
  decodeJson,
  fixture,
  makeSandbox,
  providerCalls,
  runCli,
  runtimes,
  secrets,
} from "./helpers.ts";

const app = fixture("cached");

/** The keys of the fake secrets that hold the query, as `find` lists them. */
const referencesOf = (query: string) =>
  Object.keys(secrets)
    .filter((key) => key.includes(query))
    .map((key) => ({ provider: fileProviderId, reference: `${fileProviderId}://${key}` }));

layer(NodeServices.layer, { excludeTestServices: true })("envi find", (it) => {
  describe.each(runtimes)("on %s", (runtime) => {
    it.effect("lists the references of each query and resolves no value", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");
        const result = yield* runCli(runtime, app, ["find", "token", "redis"], sandbox.env);

        expect(result.exitCode).toBe(0);

        expect(result.stdout).toBe(
          [
            "token",
            ...referencesOf("token").map((entry) => `  ${entry.reference}`),
            "redis",
            "  no match",
            "",
          ].join("\n"),
        );

        expect(yield* providerCalls(sandbox)).toEqual([]);

        for (const secret of Object.values(secrets)) {
          expect(result.stdout + result.stderr).not.toContain(secret);
        }
      }),
    );

    it.effect("prints the report as JSON", () =>
      Effect.gen(function* () {
        const sandbox = yield* makeSandbox("none");

        const result = yield* runCli(runtime, app, ["find", "db", "--json"], sandbox.env);

        expect(result.exitCode).toBe(0);

        expect(yield* decodeJson(FindReport, result.stdout)).toEqual({
          queries: [{ query: "db", references: referencesOf("db") }],
          skipped: [],
        });
      }),
    );
  });
});
