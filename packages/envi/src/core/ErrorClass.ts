// The two factories of the Envi errors. Each error explains itself: a one-line summary, a hint with
// the next action, and a link to its docs page. An error class gives only its fields,
// its summary, and its hints. The factory derives the docs link and the message.
import type * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";

/** What every Envi error explains. */
export interface Explained {
  readonly summary: string;
  readonly hint: string;
  readonly docs: string;
}

/**
 * The base of every docs link: the docs pages on GitHub. The npm package ships the same pages in
 * its `docs` folder, so the part of a link after the base is the path of a local page.
 */
export const docsBase = "https://github.com/kynnyhsap/envi/blob/main/packages/docs/content/";

const kebab = (text: string): string =>
  text.replaceAll(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase();

/** The docs page of an error, such as `errors/secret-reference-not-found.md`. */
export const pageOf = (tag: string, reason?: string): string =>
  `errors/${[kebab(tag.replace(/Error$/u, "")), ...(reason === undefined ? [] : [kebab(reason)])].join("-")}.md`;

const docsOf = (tag: string, reason?: string): string => `${docsBase}${pageOf(tag, reason)}`;

/** The text of an error: what failed, what to do next, and where the docs explain it. */
export const explain = (error: Explained): string =>
  `${error.summary}\n  hint: ${error.hint}\n  docs: ${error.docs}`;

/** The class of an Envi error. Its instances are yieldable errors that explain themselves. */
export type ErrorClass<
  Self,
  Tag extends string,
  Fields extends Schema.Struct.Fields,
> = Schema.Class<Self, Schema.TaggedStruct<Tag, Fields>, Cause.YieldableError & Explained>;

/** A text of the fields of one error. */
type Describe<ErrorFields> = (error: ErrorFields) => string;

/** The schema of the reasons of one error, such as `ProviderFailureSchema`. */
type ReasonSchema = Schema.Codec<string, string>;

type ReasonFields<Reason extends ReasonSchema, Fields extends Schema.Struct.Fields> = {
  readonly reason: Reason;
} & Fields;

/** The fields of a reason error. TypeScript cannot read `reason` from the generic struct type. */
type WithReason<
  Reason extends ReasonSchema,
  Fields extends Schema.Struct.Fields,
> = Schema.Struct.Type<Fields> & {
  readonly reason: Reason["Type"];
};

/**
 * Builds the class of one error. TypeScript cannot extend a class of a generic type, so the base
 * class has the fixed `Self` type `Explained`, and the result gets its declared type here.
 */
const build = <
  Self,
  const Tag extends string,
  const Fields extends Schema.Struct.Fields,
  ErrorFields,
>(
  tag: Tag,
  fields: Fields,
  explainer: {
    readonly summary: Describe<ErrorFields>;
    readonly hint: Describe<ErrorFields>;
    readonly docs: Describe<ErrorFields>;
  },
): ErrorClass<Self, Tag, Fields> => {
  const baseTag: string = tag;
  const baseFields: Schema.Struct.Fields = fields;

  // SAFETY: the constructor decodes the props with the schema of `fields`, which the caller types.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const fieldsOf = (error: Explained) => error as ErrorFields;

  class Explainable
    extends Schema.TaggedError<Explained>()(baseTag, baseFields)
    implements Explained
  {
    get summary(): string {
      return explainer.summary(fieldsOf(this));
    }

    get hint(): string {
      return explainer.hint(fieldsOf(this));
    }

    get docs(): string {
      return explainer.docs(fieldsOf(this));
    }

    override get message(): string {
      return explain(this);
    }
  }

  // SAFETY: `Explainable` is the class of `TaggedError(tag, fields)` with the getters of
  // `Explained`. Only the `Self` type differs, and `Self` names the subclass of the caller.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions, typescript/no-unsafe-type-assertion
  return Explainable as unknown as ErrorClass<Self, Tag, Fields>;
};

/**
 * An error with one hint, such as `DecodeError`.
 *
 * @example
 * class DecodeError extends EnviError<DecodeError>()(
 *   "DecodeError",
 *   { key: Schema.String },
 *   { summary: (error) => `Envi value does not match: ${error.key}`, hint: "Fix the value." },
 * ) {}
 */
export const EnviError =
  <Self>() =>
  <const Tag extends string, const Fields extends Schema.Struct.Fields>(
    tag: Tag,
    fields: Fields,
    explainer: { readonly summary: Describe<Schema.Struct.Type<Fields>>; readonly hint: string },
  ): ErrorClass<Self, Tag, Fields> =>
    build<Self, Tag, Fields, Schema.Struct.Type<Fields>>(tag, fields, {
      summary: explainer.summary,
      hint: () => explainer.hint,
      docs: () => docsOf(tag),
    });

/**
 * An error with a `reason` field and one hint for each reason, such as `ProviderError`. Each
 * reason has its own docs page.
 */
export const ReasonError =
  <Self>() =>
  <
    const Tag extends string,
    Reason extends ReasonSchema,
    const Fields extends Schema.Struct.Fields,
  >(
    tag: Tag,
    reason: Reason,
    fields: Fields,
    explainer: {
      readonly summary: Describe<WithReason<Reason, Fields>>;
      readonly hints: Readonly<Record<Reason["Type"], string>>;
    },
  ): ErrorClass<Self, Tag, ReasonFields<Reason, Fields>> =>
    build<Self, Tag, ReasonFields<Reason, Fields>, WithReason<Reason, Fields>>(
      tag,
      { reason, ...fields },
      {
        summary: explainer.summary,
        hint: (error) => explainer.hints[error.reason],
        docs: (error) => docsOf(tag, error.reason),
      },
    );
