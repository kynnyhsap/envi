import * as Effect from "effect/Effect";

import { fixtureVaults } from "./fixture.ts";

/** The fake value of one fixture field. It fails when the manifest does not hold the field. */
export const expected = (vault: string, item: string, field: string) =>
  Effect.fromNullishOr(
    fixtureVaults
      .find((candidate) => candidate.title === vault)
      ?.items.find((candidate) => candidate.title === item)
      ?.fields.find((candidate) => candidate.title === field)?.value,
  );
