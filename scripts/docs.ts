import { Command } from "effect/cli";
// Checks the docs pages in `packages/docs/content`. The npm package of Envi ships them, and the
// website will serve them later, so each page must stand on its own:
//
// - The page starts with a frontmatter of a JSON string `title` and a JSON string `description`.
// - The first heading of the page is `# <title>`.
// - Every relative link names an existing page.
//
//   bun run docs:check   fails when a page breaks a rule
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { root, runCommand, ScriptError } from "./Workspace.ts";

/** The folder of the docs pages, from the repo root. */
const contentFolder = "packages/docs/content";

const pageSuffix = ".md";

/** The frontmatter at the start of a page, and the rest of the page. */
const frontmatter = /^---\n(?<block>[\s\S]*?)\n---\n(?<rest>[\s\S]*)$/u;

/** One line of the frontmatter, such as `title: "Cache"`. */
const frontmatterLine = /^(?<key>[a-z]+): (?<value>".*")$/u;

/** A relative link to a page, such as `](../cache.md)` or `](./errors/vars.md#anchor)`. */
const relativeLink = /\]\((?<target>(?!https?:)[^)\s#]+\.md)(?:#[^)\s]*)?\)/gu;

const Frontmatter = Schema.Struct({
  title: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
});

const decodeFrontmatter = Schema.decodeUnknownOption(Schema.fromJsonString(Frontmatter));

/** The frontmatter as one JSON object: each line gives one key and its JSON string. */
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

/** The problems of one page. Each problem is one line. */
const pageProblems = (
  page: string,
  text: string,
  exists: (target: string) => boolean,
  path: Path.Path,
): ReadonlyArray<string> => {
  const { block, rest } = frontmatter.exec(text)?.groups ?? {};

  if (block === undefined || rest === undefined) {
    return [`${page}: has no frontmatter.`];
  }

  const headerProblems = Option.match(frontmatterOf(block), {
    onNone: () => [
      `${page}: the frontmatter needs a JSON string title and a JSON string description.`,
    ],
    onSome: ({ title }) =>
      rest.trimStart().startsWith(`# ${title}\n`)
        ? []
        : [`${page}: the first heading is not "# ${title}".`],
  });

  const linkProblems = [...text.matchAll(relativeLink)].flatMap((link) => {
    const target = path.join(path.dirname(page), link.groups?.["target"] ?? "");

    return exists(target) ? [] : [`${page}: links to ${target}, which does not exist.`];
  });

  return [...headerProblems, ...linkProblems];
};

const command = Command.make("docs", {}, () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = path.join(root, contentFolder);

    const pages = (yield* fs.readDirectory(folder, { recursive: true })).filter((name) =>
      name.endsWith(pageSuffix),
    );

    const known = new Set(pages);

    const problems = yield* Effect.forEach(pages, (page) =>
      Effect.map(fs.readFileString(path.join(folder, page)), (text) =>
        pageProblems(page, text, (target) => known.has(target), path),
      ),
    );

    const all = problems.flat();

    return yield* all.length === 0
      ? Console.log(`Every one of the ${pages.length} docs pages passes.`)
      : Effect.fail(new ScriptError({ detail: `The docs check failed:\n${all.join("\n")}` }));
  }),
);

runCommand(command);
