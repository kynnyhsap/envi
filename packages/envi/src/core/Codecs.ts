// Codecs for env values that Effect does not ship. Effect ships `Schema.FiniteFromString`.
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

/** The texts that `BooleanFromString` accepts. */
const booleanTexts = ["true", "false", "1", "0"] as const;

const trueTexts: ReadonlyArray<string> = ["true", "1"];

/**
 * A flag such as `FEATURE_X=true`. It decodes `true` and `1` to `true`, and `false` and `0` to
 * `false`. Any other text fails, so a typo never turns a flag off.
 */
export const BooleanFromString: Schema.Codec<boolean, string> = Schema.Literals(booleanTexts).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((text) => trueTexts.includes(text)),
    encode: SchemaGetter.transform((flag): (typeof booleanTexts)[number] =>
      flag ? "true" : "false",
    ),
  }),
);
