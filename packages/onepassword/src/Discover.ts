// The search of `envi find`. The SDK has no search, so the provider lists the vaults, the items of
// each vault, and the fields of each item that matches, and it compares the titles in memory. It
// decodes each answer with a schema without a value, so no value leaves the answer of the SDK.
import { type Provider, type ProviderError, ProviderFailure, Timing } from "@kynnyhsap/envi";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { CredentialKind } from "./Credential.ts";
import { failure } from "./Failure.ts";
import { isPart, type OpReference, Reference } from "./Reference.ts";
import * as Sdk from "./Sdk.ts";

/** A vault, an item, or a section: the parts of a listing that a reference can name. */
const Named = Schema.Struct({ id: Schema.String, title: Schema.String });

type Named = typeof Named.Type;

const Field = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  sectionId: Schema.optional(Schema.NullOr(Schema.String)),
});

type Field = typeof Field.Type;

/** One item without its values. The schema drops every key that it does not name. */
const Item = Schema.Struct({
  id: Schema.String,
  sections: Schema.Array(Named),
  fields: Schema.Array(Field),
});

type Item = typeof Item.Type;

const GetAllResponse = Schema.Struct({
  individualResponses: Schema.Array(
    Schema.Struct({ content: Schema.optional(Schema.NullOr(Item)) }),
  ),
});

const decodeNamed = Schema.decodeUnknownEffect(Schema.Array(Named));

const decodeItems = Schema.decodeUnknownEffect(GetAllResponse);

/** The most items that one query lists. */
const maxMatches = 10;

/** A close title differs from the query by one edit for each of these characters of the query. */
const charactersPerEdit = 4;

/** The score of a title that holds the query. An equal title scores 0, a close title more. */
const containsScore = 1;

/** What one query names: an item, and with a reference also a vault and a field. */
interface Target {
  readonly vault: Option.Option<string>;
  readonly item: string;
  readonly field: Option.Option<string>;
}

/** One item of the listing and its vault. */
interface Listed {
  readonly vault: Named;
  readonly item: Named;
}

// The decode error can hold a value of the answer, so the failure holds only a fixed text.
const invalid = () =>
  failure(ProviderFailure.InvalidResponse, "1Password returned a listing of an unknown form.");

const unavailable = "The listing of the 1Password vaults failed.";

/** A reference query names its vault, its item, and its field. Any other query names an item. */
const targetOf = (query: string): Target =>
  Option.match(Schema.decodeUnknownOption(Reference)({ uri: query }), {
    onNone: () => ({ vault: Option.none(), item: query, field: Option.none() }),
    onSome: (reference) => ({
      vault: Option.some(reference.vault),
      item: reference.item,
      field: Option.some(reference.field),
    }),
  });

/** The Levenshtein distance: the fewest edits of one character that turn `left` into `right`. */
const distance = (left: string, right: string): number => {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (const [row, char] of Array.from(left).entries()) {
    const current = [row + 1];

    for (const [column, other] of Array.from(right).entries()) {
      const replace = (previous[column] ?? 0) + (char === other ? 0 : 1);

      current.push(Math.min((previous[column + 1] ?? 0) + 1, (current[column] ?? 0) + 1, replace));
    }

    previous = current;
  }

  return previous[right.length] ?? 0;
};

/** The distance of a name from a wanted name. An equal ID scores 0. */
const distanceOf = (named: Named, wanted: string) =>
  named.id === wanted ? 0 : distance(named.title.toLowerCase(), wanted.toLowerCase());

/** The score of an item for a wanted name, or none when the title is not close. Lower is better. */
const scoreOf = (item: Named, wanted: string): Option.Option<number> => {
  const title = item.title.toLowerCase();
  const query = wanted.toLowerCase();

  if (title === query || item.id === wanted) {
    return Option.some(0);
  }

  if (title.includes(query)) {
    return Option.some(containsScore);
  }

  const edits = distance(title, query);
  const allowed = Math.max(1, Math.floor(query.length / charactersPerEdit));

  return edits <= allowed ? Option.some(containsScore + edits) : Option.none();
};

/** The items of one query, best first: by the item, then by the vault of a reference. */
const matchesOf = (listed: ReadonlyArray<Listed>, target: Target): ReadonlyArray<Listed> =>
  listed
    .flatMap((entry) =>
      Option.match(scoreOf(entry.item, target.item), {
        onNone: () => [],
        onSome: (score) => [
          {
            entry,
            score,
            vaultScore: Option.match(target.vault, {
              onNone: () => 0,
              onSome: (vault) => distanceOf(entry.vault, vault),
            }),
          },
        ],
      }),
    )
    .toSorted((left, right) => left.score - right.score || left.vaultScore - right.vaultScore)
    .slice(0, maxMatches)
    .map(({ entry }) => entry);

/** The title of a part when a reference can name it and no other part shares it, or its ID. */
const partOf = (named: Named, siblings: ReadonlyArray<Named>): string => {
  const title = named.title.toLowerCase();

  return isPart(named.title) &&
    siblings.filter((sibling) => sibling.title.toLowerCase() === title).length === 1
    ? named.title
    : named.id;
};

/** The section part of a field. A field outside a section, or in one without a title, has none. */
const sectionOf = (item: Item, field: Field): Option.Option<string> =>
  Option.map(
    Option.filter(
      Option.fromUndefinedOr(item.sections.find((section) => section.id === field.sectionId)),
      (section) => section.title !== "",
    ),
    (section) => partOf(section, item.sections),
  );

/** The references of the fields of one item, with the closest field to a reference first. */
const referencesOf = (
  context: { readonly vaults: ReadonlyArray<Named>; readonly listed: ReadonlyArray<Listed> },
  entry: Listed,
  item: Item,
  target: Target,
): ReadonlyArray<OpReference> => {
  const vault = partOf(entry.vault, context.vaults);

  const itemPart = partOf(
    entry.item,
    context.listed.filter((other) => other.vault.id === entry.vault.id).map((other) => other.item),
  );

  const fields = Option.match(target.field, {
    onNone: () => item.fields,
    onSome: (wanted) =>
      item.fields.toSorted((left, right) => distanceOf(left, wanted) - distanceOf(right, wanted)),
  });

  return fields.map((field) => ({
    vault,
    item: itemPart,
    ...Option.match(sectionOf(item, field), {
      onNone: () => ({}),
      onSome: (section) => ({ section }),
    }),
    field: partOf(field, item.fields),
  }));
};

/**
 * Lists the vaults and their items: one call for the vaults, then one call for each vault.
 *
 * @returns The vaults, and each item with its vault, in the order of the SDK.
 */
const listAll = <DesktopAuth>(
  sdk: Sdk.Sdk<DesktopAuth>,
  kind: CredentialKind,
  client: Sdk.SdkClient,
) =>
  Effect.gen(function* () {
    const vaults = yield* Effect.flatMap(
      Sdk.call(sdk, kind, unavailable, () => client.vaults.list()),
      (answer) => Effect.mapError(decodeNamed(answer), invalid),
    );

    const listed = yield* Effect.forEach(vaults, (vault) =>
      Effect.flatMap(
        Sdk.call(sdk, kind, unavailable, () => client.items.list(vault.id)),
        (answer) =>
          Effect.map(Effect.mapError(decodeNamed(answer), invalid), (items) =>
            items.map((item) => ({ vault, item })),
          ),
      ),
    );

    return { vaults, listed: listed.flat() };
  });

/** Reads the fields of the matched items: one call for each vault that holds a match. */
const readItems = <DesktopAuth>(
  sdk: Sdk.Sdk<DesktopAuth>,
  kind: CredentialKind,
  client: Sdk.SdkClient,
  context: { readonly vaults: ReadonlyArray<Named>; readonly listed: ReadonlyArray<Listed> },
  matched: ReadonlySet<string>,
) =>
  Effect.map(
    Effect.forEach(
      context.vaults.flatMap((vault) => {
        const ids = context.listed
          .filter((entry) => entry.vault.id === vault.id && matched.has(entry.item.id))
          .map((entry) => entry.item.id);

        return ids.length === 0 ? [] : [{ vault, ids }];
      }),
      ({ vault, ids }) =>
        Effect.flatMap(
          Sdk.call(sdk, kind, unavailable, () => client.items.getAll(vault.id, ids)),
          (answer) => Effect.mapError(decodeItems(answer), invalid),
        ),
    ),
    (answers) =>
      new Map(
        answers
          .flatMap((answer) => answer.individualResponses)
          .flatMap((response) =>
            response.content ? [[response.content.id, response.content]] : [],
          ),
      ),
  );

/** Lists the references whose item titles match each query, best match first. */
export const discover = <DesktopAuth>(
  sdk: Sdk.Sdk<DesktopAuth>,
  kind: CredentialKind,
  client: Sdk.SdkClient,
  queries: ReadonlyArray<string>,
): Effect.Effect<Provider.DiscoverResults<OpReference>, ProviderError> =>
  Effect.gen(function* () {
    const context = yield* listAll(sdk, kind, client);

    const searches = queries.map((query) => {
      const target = targetOf(query);

      return { query, target, matches: matchesOf(context.listed, target) };
    });

    const matched = new Set(
      searches.flatMap((search) => search.matches.map(({ item }) => item.id)),
    );

    const items = yield* readItems(sdk, kind, client, context, matched);

    return Object.fromEntries(
      searches.map(({ query, target, matches }) => [
        query,
        matches.flatMap((entry) =>
          Option.match(Option.fromUndefinedOr(items.get(entry.item.id)), {
            onNone: () => [],
            onSome: (item) => referencesOf(context, entry, item, target),
          }),
        ),
      ]),
    );
  }).pipe(Timing.measure(Sdk.Step.Discover, { queries: queries.length }));
