// The docs pages that ship with Envi. `envi docs` reads them offline, so an agent reads the docs of
// the installed version. Each page starts with a frontmatter of a JSON string `title` and a JSON
// string `description`. The text of a page starts at its first heading.
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { docsBase } from "./ErrorClass.ts";
import { DocsError, DocsFailure } from "./Errors.ts";
import type { DocsPageReport } from "./Reports.ts";

/** The file suffix of a page. A page name has no suffix, such as `errors/vars`. */
export const pageSuffix = ".md";

/** The page that maps each task to a page. `envi docs` prints it. */
export const indexPage = "README";

/** The frontmatter at the start of a page, and the rest of the page. */
const frontmatter = /^---\n(?<block>[\s\S]*?)\n---\n(?<body>[\s\S]*)$/u;

/** One line of the frontmatter, such as `title: "Cache"`. */
const frontmatterLine = /^(?<key>[a-z]+): (?<value>".*")$/u;

/** The anchor of a link, such as `#usage`. */
const anchor = /#.*$/u;

const Frontmatter = Schema.Struct({
  title: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
});

const decodeFrontmatter = Schema.decodeUnknownOption(Schema.fromJsonString(Frontmatter));

/** The fields of a page: the lines of its frontmatter as one JSON object. */
const frontmatterOf = (block: string) =>
  decodeFrontmatter(
    `{${block
      .split("\n")
      .flatMap((line) => {
        const groups = frontmatterLine.exec(line)?.groups;

        return groups === undefined ? [] : [`"${groups["key"]}": ${groups["value"]}`];
      })
      .join(", ")}}`,
  );

/** One page with its fields and its text. `None` when the page has no valid frontmatter. */
const parse = (page: string, path: string, text: string): Option.Option<DocsPageReport> => {
  const { block, body } = frontmatter.exec(text)?.groups ?? {};

  return block === undefined || body === undefined
    ? Option.none()
    : Option.map(frontmatterOf(block), (fields) => ({
        page,
        ...fields,
        path,
        text: body.trimStart(),
      }));
};

/**
 * The page name of a name, a file name, or a docs link, such as `errors/vars`, `errors/vars.md`,
 * or the `docs` link of an error.
 */
const pageName = (input: string): string => {
  const name = input.replace(docsBase, "").replace(anchor, "").replace(/^\.\//u, "");

  return name.endsWith(pageSuffix) ? name.slice(0, -pageSuffix.length) : name;
};

/** `true` when the text holds every word, in any case. */
const holdsAll = (text: string, words: ReadonlyArray<string>): boolean => {
  const lower = text.toLowerCase();

  return words.every((word) => lower.includes(word));
};

/** The pages with every word in the title come first, then those with every word in the description. */
const searchOrder = (words: ReadonlyArray<string>): Order.Order<DocsPageReport> =>
  Order.combine(
    Order.mapInput(Order.Boolean, (page: DocsPageReport) => !holdsAll(page.title, words)),
    Order.mapInput(Order.Boolean, (page: DocsPageReport) => !holdsAll(page.description, words)),
  );

export interface Interface {
  /** The docs folder. */
  readonly folder: string;
  /** Every page, in the order of its name. */
  readonly list: Effect.Effect<ReadonlyArray<DocsPageReport>, DocsError>;
  /** One page by its name, its file name, or its docs link. */
  readonly show: (input: string) => Effect.Effect<DocsPageReport, DocsError>;
  /** The pages that hold every word of the query, in `searchOrder`. */
  readonly search: (query: string) => Effect.Effect<ReadonlyArray<DocsPageReport>, DocsError>;
}

/** The docs pages of one folder. */
export class Docs extends Context.Service<Docs, Interface>()("envi/Docs") {}

const unreadable = (page: string) => new DocsError({ reason: DocsFailure.Unreadable, page });

const make = (folder: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const readPage = (name: string) => {
      const file = path.join(folder, name);
      const page = name.slice(0, -pageSuffix.length);

      return Effect.flatMap(
        Effect.mapError(fs.readFileString(file), () => unreadable(page)),
        (text) =>
          Option.match(parse(page, file, text), {
            onNone: () => Effect.fail(unreadable(page)),
            onSome: Effect.succeed,
          }),
      );
    };

    const list = Effect.flatMap(
      Effect.mapError(fs.readDirectory(folder, { recursive: true }), () => unreadable(folder)),
      (names) =>
        Effect.forEach(names.filter((name) => name.endsWith(pageSuffix)).toSorted(), readPage),
    );

    const show = (input: string) =>
      Effect.flatMap(list, (pages) => {
        const page = pages.find((entry) => entry.page === pageName(input));

        return page === undefined
          ? Effect.fail(new DocsError({ reason: DocsFailure.NotFound, page: input }))
          : Effect.succeed(page);
      });

    const search = (query: string) => {
      const words = query
        .toLowerCase()
        .split(/\s+/u)
        .filter((word) => word !== "");

      return Effect.map(list, (pages) =>
        Arr.sort(
          pages.filter((page) => holdsAll(`${page.description}\n${page.text}`, words)),
          searchOrder(words),
        ),
      );
    };

    return Docs.of({ folder, list, show, search });
  });

/** The docs pages of a folder, such as the `docs` folder of the Envi package. */
export const layer = (
  folder: string,
): Layer.Layer<Docs, never, FileSystem.FileSystem | Path.Path> => Layer.effect(Docs, make(folder));
