// The frontmatter of a Markdown file, such as a docs page or an agent skill. Each line holds one key
// and its JSON string, such as `title: "Cache"`. A JSON string is also a valid YAML string, so a
// YAML reader, such as the one of a website or of an agent, reads the same fields.
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** The frontmatter at the start of a file, and the rest of the file. */
const block = /^---\n(?<lines>[\s\S]*?)\n---\n(?<body>[\s\S]*)$/u;

/** One line of the frontmatter, such as `title: "Cache"`. */
const line = /^(?<key>[a-z]+): (?<value>".*")$/u;

/** A file with its fields and the text after its frontmatter, from the first non-blank line. */
export interface Parsed<A> {
  readonly fields: A;
  readonly body: string;
}

/**
 * A parser of the frontmatter that decodes the fields with a schema. The parser gives `None` when
 * the file has no frontmatter, or when the fields do not match the schema.
 */
export const parser = <A, I>(schema: Schema.Codec<A, I>) => {
  const decode = Schema.decodeUnknownOption(Schema.fromJsonString(schema));

  return (text: string): Option.Option<Parsed<A>> => {
    const groups = block.exec(text)?.groups;

    if (groups?.["lines"] === undefined || groups["body"] === undefined) {
      return Option.none();
    }

    const body = groups["body"].trimStart();

    const json = groups["lines"].split("\n").flatMap((entry) => {
      const field = line.exec(entry)?.groups;

      return field === undefined ? [] : [`"${field["key"]}": ${field["value"]}`];
    });

    return Option.map(decode(`{${json.join(", ")}}`), (fields) => ({ fields, body }));
  };
};
