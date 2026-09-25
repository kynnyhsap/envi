import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";
import { Source } from "envi";

/** The id of the 1Password provider. */
export const providerId = "onepassword";

const scheme = "op://";

/**
 * One part of a reference. The reference syntax has no escape, so `op://app/api/prod/key` names
 * the item `api` and the section `prod`. A name with `/` or `?` needs its ID instead.
 */
const Part = Schema.NonEmptyString.check(
  Schema.isPattern(/^[^/?]+$/u, {
    message: "A 1Password name with / or ? needs its ID. Use the item ID or the vault ID instead",
  }),
);

/** The normalized reference. All three forms of `op()` decode to it. */
export const OpReference = Schema.Struct({
  /** The account of this one reference. It wins over the account of the provider. */
  account: Schema.optionalKey(Part),
  vault: Part,
  item: Part,
  section: Schema.optionalKey(Part),
  field: Part,
});

export type OpReference = typeof OpReference.Type;

/** The object form of `op()`. */
export interface OpReferenceInput {
  readonly account?: string;
  readonly vault: string;
  readonly item: string;
  readonly section?: string;
  readonly field: string;
}

const unsupported = (message: string) => Effect.fail(new SchemaIssue.InvalidValue({ message }));

/** `op://vault/item/field` or `op://vault/item/section/field`. Envi supports no query attribute. */
const parseUri = (uri: string): Effect.Effect<OpReference, SchemaIssue.Issue> => {
  if (!uri.startsWith(scheme)) {
    return unsupported("A 1Password reference starts with op://");
  }

  if (uri.includes("?")) {
    return unsupported("Envi supports no query attribute, such as ?attribute=otp");
  }

  const parts = uri.slice(scheme.length).split("/");

  if (parts.some((part) => part === "")) {
    return unsupported("A 1Password reference has no empty part");
  }

  const [vault, item, third, fourth] = parts;

  if (vault === undefined || item === undefined || third === undefined || parts.length > 4) {
    return unsupported(
      "A 1Password reference is op://vault/item/field or op://vault/item/section/field",
    );
  }

  return Effect.succeed(
    fourth === undefined
      ? { vault, item, field: third }
      : { vault, item, section: third, field: fourth },
  );
};

/** The safe text of a reference. It never holds a secret, and it never holds the account. */
export const describeReference = (reference: OpReference): string =>
  [
    `${scheme}${reference.vault}`,
    reference.item,
    ...(reference.section === undefined ? [] : [reference.section]),
    reference.field,
  ].join("/");

const UriForm = Schema.Struct({ uri: Schema.String }).pipe(
  Schema.decodeTo(OpReference, {
    decode: SchemaGetter.transformEffect((input: { readonly uri: string }) => parseUri(input.uri)),
    encode: SchemaGetter.transform((reference: OpReference) => ({
      uri: describeReference(reference),
    })),
  }),
);

/** Decodes the JSON reference of a descriptor. An invalid reference fails here, not in `vars`. */
export const Reference = Schema.Union([UriForm, OpReference]);

/** The three forms of `op()`: a reference string, `(vault, item, field)`, and an object. */
export interface Op {
  (uri: string): Source.Source;
  (vault: string, item: string, field: string): Source.Source;
  (input: OpReferenceInput): Source.Source;
}

/** A descriptor of one 1Password value. It resolves nothing and imports no 1Password code. */
export const op: Op = (
  first: string | OpReferenceInput,
  item?: string,
  field?: string,
): Source.Source => {
  if (!Predicate.isString(first)) {
    return Source.reference(providerId, { ...first });
  }

  return item === undefined || field === undefined
    ? Source.reference(providerId, { uri: first })
    : Source.reference(providerId, { vault: first, item, field });
};
