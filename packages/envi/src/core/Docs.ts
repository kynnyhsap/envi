// The docs pages that ship with Envi. `envi docs` reads them offline, so an agent reads the docs of
// the installed version. Each page starts with a frontmatter of a `title` and a `description`. The
// text of a page starts at its first heading. A package that lost its `docs` folder, such as to a
// tool that prunes `node_modules`, reads one page at a time from GitHub, at the tag of its version.
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { docsBase } from "./ErrorClass.ts";
import { DocsError, DocsFailure } from "./Errors.ts";
import * as Frontmatter from "./Frontmatter.ts";
import type { DocsPageReport } from "./Reports.ts";

/** The file suffix of a page. A page name has no suffix, such as `errors/vars`. */
export const pageSuffix = ".md";

/** The page that maps each task to a page. `envi docs` prints it. */
export const indexPage = "README";

/** The anchor of a link, such as `#usage`. */
const anchor = /#.*$/u;

const parseFrontmatter = Frontmatter.parser(
  Schema.Struct({ title: Schema.NonEmptyString, description: Schema.NonEmptyString }),
);

/** One page with its fields and its text. `None` when the page has no valid frontmatter. */
const parse = (page: string, path: string, text: string): Option.Option<DocsPageReport> =>
  Option.map(parseFrontmatter(text), ({ fields, body }) => ({ page, ...fields, path, text: body }));

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

/** A page name that GitHub can serve, such as `errors/vars`: words and folders, no `..`. */
const remoteName = /^[A-Za-z0-9-]+(?:\/[A-Za-z0-9-]+)*$/u;

/** The HTTP status of a missing page. */
const notFoundStatus = 404;

/** The longest wait for a page from GitHub. */
const remoteTimeout = "10 seconds";

export interface Interface {
  /** The docs folder. */
  readonly folder: string;
  /** Every page, in the order of its name. It needs the docs folder. */
  readonly list: Effect.Effect<ReadonlyArray<DocsPageReport>, DocsError>;
  /**
   * One page by its name, its file name, or its docs link. Without a complete docs folder, the page
   * comes from GitHub at the tag of this version.
   */
  readonly show: (input: string) => Effect.Effect<DocsPageReport, DocsError>;
  /** The pages that hold every word of the query, in `searchOrder`. It needs the docs folder. */
  readonly search: (query: string) => Effect.Effect<ReadonlyArray<DocsPageReport>, DocsError>;
  /** The docs folder, or the file of one page. It needs the docs folder. */
  readonly path: (input: Option.Option<string>) => Effect.Effect<string, DocsError>;
}

/** The docs pages of one folder, with the pages on GitHub as the fallback. */
export class Docs extends Context.Service<Docs, Interface>()("envi/Docs") {}

/** The dependencies of each operation. */
interface Source {
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly http: HttpClient.HttpClient;
  /** The docs folder of the package. */
  readonly folder: string;
  /** The URL of the docs folder of this version on GitHub. It ends with `/`. */
  readonly remote: string;
}

const unreadable = (page: string) => new DocsError({ reason: DocsFailure.Unreadable, page });

const notFound = (input: string) => new DocsError({ reason: DocsFailure.NotFound, page: input });

const fileOf = (name: string) => `${name}${pageSuffix}`;

/** The file of every page. A folder without the index page is incomplete, so it fails. */
const pageFiles = (source: Source) =>
  source.fs.readDirectory(source.folder, { recursive: true }).pipe(
    Effect.mapError(() => unreadable(source.folder)),
    Effect.map((names) => names.filter((name) => name.endsWith(pageSuffix)).toSorted()),
    Effect.filterOrFail(
      (files) => files.includes(fileOf(indexPage)),
      () => unreadable(source.folder),
    ),
  );

/** One page of the docs folder, such as `errors/vars.md`. */
const readPage = (source: Source, file: string) => {
  const page = file.slice(0, -pageSuffix.length);
  const absolute = source.path.join(source.folder, file);

  return Effect.flatMap(
    Effect.mapError(source.fs.readFileString(absolute), () => unreadable(page)),
    (text) =>
      Option.match(parse(page, absolute, text), {
        onNone: () => Effect.fail(unreadable(page)),
        onSome: Effect.succeed,
      }),
  );
};

/** One page from GitHub. A missing page fails with `NotFound`, and any other failure with `Unreadable`. */
const fetchPage = (source: Source, input: string, name: string) => {
  const url = `${source.remote}${fileOf(name)}`;

  const text = source.http.get(url).pipe(
    Effect.filterOrFail(
      (response) => response.status !== notFoundStatus,
      () => notFound(input),
    ),
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.text),
    Effect.timeout(remoteTimeout),
    Effect.mapError((error) => (error instanceof DocsError ? error : unreadable(source.folder))),
  );

  return remoteName.test(name)
    ? Effect.flatMap(text, (body) =>
        Option.match(parse(name, url, body), {
          onNone: () => Effect.fail(unreadable(url)),
          onSome: Effect.succeed,
        }),
      )
    : Effect.fail(notFound(input));
};

const list = (source: Source) =>
  Effect.flatMap(pageFiles(source), (files) =>
    Effect.forEach(files, (file) => readPage(source, file)),
  );

const show = (source: Source, input: string) => {
  const name = pageName(input);

  return Effect.matchEffect(pageFiles(source), {
    onFailure: () => fetchPage(source, input, name),
    onSuccess: (files) =>
      files.includes(fileOf(name)) ? readPage(source, fileOf(name)) : Effect.fail(notFound(input)),
  });
};

const search = (source: Source, query: string) => {
  const words = query
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== "");

  return Effect.map(list(source), (pages) =>
    Arr.sort(
      pages.filter((page) => holdsAll(`${page.description}\n${page.text}`, words)),
      searchOrder(words),
    ),
  );
};

const pagePath = (source: Source, input: Option.Option<string>) =>
  Effect.flatMap(pageFiles(source), (files) =>
    Option.match(input, {
      onNone: () => Effect.succeed(source.folder),
      onSome: (page) => {
        const file = fileOf(pageName(page));

        return files.includes(file)
          ? Effect.succeed(source.path.join(source.folder, file))
          : Effect.fail(notFound(page));
      },
    }),
  );

const make = (folder: string, remote: string) =>
  Effect.gen(function* () {
    const source: Source = {
      fs: yield* FileSystem.FileSystem,
      path: yield* Path.Path,
      http: yield* HttpClient.HttpClient,
      folder,
      remote,
    };

    return Docs.of({
      folder,
      list: list(source),
      show: (input) => show(source, input),
      search: (query) => search(source, query),
      path: (input) => pagePath(source, input),
    });
  });

/**
 * The docs pages of a folder, such as the `docs` folder of the Envi package, and the URL of the
 * same folder on GitHub, for a package that lost its folder.
 */
export const layer = (
  folder: string,
  remote: string,
): Layer.Layer<Docs, never, FileSystem.FileSystem | Path.Path | HttpClient.HttpClient> =>
  Layer.effect(Docs, make(folder, remote));
