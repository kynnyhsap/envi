// The close references of a `NotFound` failure. After a resolution, Envi asks each provider that
// can search for the references close to each missing reference, in one call for each provider,
// and adds the closest ones to the error. The search is best effort: a failure, a defect, or a slow
// provider gives no candidates, and the error stays `NotFound`.
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import { ReferenceFailure, SecretReferenceError, type VarError } from "./Errors.ts";
import * as Provider from "./Provider.ts";

/** The most close references of one failure. */
const maxCandidates = 3;

/** The longest wait for the search of one provider. A failed run should not wait long. */
const searchTimeout = Duration.fromInputUnsafe("10 seconds");

type Outcomes<A> = Readonly<Record<string, Result.Result<A, VarError>>>;

/** The error of a required var whose reference does not exist. */
const missingOf = (
  outcome: Result.Result<unknown, VarError>,
): Option.Option<SecretReferenceError> =>
  Option.filter(
    Result.getFailure(outcome),
    (error): error is SecretReferenceError =>
      error instanceof SecretReferenceError && error.reason === ReferenceFailure.NotFound,
  );

/** The search of one provider for its missing references. Every failure gives no result. */
const search = (
  providers: Provider.Interface,
  id: string,
  references: ReadonlyArray<string>,
  context: Provider.ResolveContext,
) =>
  providers.get(id).pipe(
    Effect.flatMap((provider) =>
      Option.match(provider.discover, {
        onNone: () => Effect.succeed<Provider.DiscoverResults<string>>({}),
        onSome: (discover) => discover(references, context),
      }),
    ),
    Effect.timeoutOption(searchTimeout),
    Effect.map(Option.getOrElse((): Provider.DiscoverResults<string> => ({}))),
    Effect.catchCause(() => Effect.succeed<Provider.DiscoverResults<string>>({})),
    Effect.map((results) => [id, results] as const),
  );

/**
 * Adds the close references to each `NotFound` failure of a required var.
 *
 * @returns The same outcomes. A failure without a search result keeps its error.
 */
export const attach = Effect.fn("Candidates.attach")(function* <A>(
  vars: Outcomes<A>,
  context: Provider.ResolveContext,
) {
  const missing = Object.values(vars).flatMap((outcome) => Option.toArray(missingOf(outcome)));

  if (missing.length === 0) {
    return vars;
  }

  const providers = yield* Provider.Providers;

  const searched = yield* Effect.forEach(
    Object.entries(Arr.groupBy(missing, (error) => error.provider)),
    ([id, errors]) =>
      search(providers, id, Arr.dedupe(errors.map((error) => error.reference)), context),
  );

  const results = new Map(searched);

  return Object.fromEntries(
    Object.entries(vars).map(([key, outcome]) => [
      key,
      Option.match(missingOf(outcome), {
        onNone: () => outcome,
        onSome: (error) => {
          const candidates = (results.get(error.provider)?.[error.reference] ?? [])
            .filter((candidate) => candidate !== error.reference)
            .slice(0, maxCandidates);

          return candidates.length === 0
            ? outcome
            : Result.fail(
                new SecretReferenceError({
                  reason: error.reason,
                  provider: error.provider,
                  reference: error.reference,
                  candidates,
                }),
              );
        },
      }),
    ]),
  );
});
