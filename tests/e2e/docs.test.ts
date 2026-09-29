// `envi docs`: an agent or a user reads the docs of the installed Envi offline, in a folder
// without a config. Each expectation comes from the pages in `packages/docs/content`. A package
// without its `docs` folder reads a page from GitHub, which a local server stands in for.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import {
  DocsListReport,
  DocsPageReport,
  DocsPathReport,
  DocsSearchReport,
  ErrorReport,
} from "@kynnyhsap/envi";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { readFile } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

import enviManifest from "../../packages/envi/package.json" with { type: "json" };
import { decodeJson, docsOf, enviVersion, runCli, runProcess, runtimes } from "./helpers.ts";

const content = fileURLToPath(new URL("../../packages/docs/content", import.meta.url));

const pageSuffix = ".md";

/** The frontmatter and the body of a page, such as `---\ntitle: "Cache"\n---\n\n# Cache`. */
const pageParts = /^---\n(?<block>[\s\S]*?)\n---\n(?<body>[\s\S]*)$/u;

const decodeField = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.String));

/** The JSON string of one frontmatter key, decoded. */
const field = (block: string, key: string) =>
  decodeField(new RegExp(`^${key}: (".*")$`, "mu").exec(block)?.[1]);

/** One page of the docs source: its name without the suffix, its fields, and its text. */
const sourcePage = Effect.fn("sourcePage")(function* (name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fs.readFileString(path.join(content, name));
  const { block = "", body = "" } = pageParts.exec(text)?.groups ?? {};

  return {
    page: name.slice(0, -pageSuffix.length),
    title: yield* field(block, "title"),
    description: yield* field(block, "description"),
    body: body.trimStart(),
  };
});

/** Every page of the docs source, in the order of its file name. */
const sourcePages = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const names = (yield* fs.readDirectory(content, { recursive: true }))
    .filter((name) => name.endsWith(pageSuffix))
    .toSorted();

  return yield* Effect.forEach(names, sourcePage);
});

const enviFolder = fileURLToPath(new URL("../../packages/envi", import.meta.url));

/** The placeholder of the version in `config.docsUrl` of the manifest. */
const versionPlaceholder = "{version}";

const tagPrefix = `/v${enviVersion}/`;

/** Serves the docs pages only below the tag of this version, the way GitHub serves a tag. */
const servePage = (request: IncomingMessage, response: ServerResponse) => {
  const url = request.url ?? "";

  if (!url.startsWith(tagPrefix)) {
    response.writeHead(404).end();

    return;
  }

  readFile(`${content}/${url.slice(tagPrefix.length)}`, (error, data) => {
    if (error === null) {
      response.writeHead(200).end(data);
    } else {
      response.writeHead(404).end();
    }
  });
};

const listening = Effect.callback<Server>((resume) => {
  const server = createServer(servePage);

  server.listen(0, "127.0.0.1", () => {
    resume(Effect.succeed(server));
  });
});

const closed = (server: Server) =>
  Effect.callback<void>((resume) => {
    server.close(() => {
      resume(Effect.void);
    });
  });

const decodeAddress = Schema.decodeUnknownEffect(Schema.Struct({ port: Schema.Number }));

/**
 * The docs URL of a local server in place of GitHub, with the placeholder of the version, as the
 * manifest holds it. The server closes with the scope.
 */
const docsServerUrl = Effect.acquireRelease(listening, closed).pipe(
  Effect.flatMap((server) => decodeAddress(server.address())),
  Effect.map(({ port }) => `http://127.0.0.1:${port}/v${versionPlaceholder}/`),
);

/** A docs URL where nothing answers: the port of a server that already closed. */
const closedDocsUrl = Effect.scoped(docsServerUrl);

/**
 * The built Envi package without its `docs` folder, the way a tool that prunes `node_modules`
 * leaves it. `dist` is a copy, not a link, so the CLI looks for the `docs` folder of the copy. The
 * app folder lies outside the copy, so the CLI does not hand off to the Envi of the repo.
 */
const packageWithoutDocs = Effect.fn("packageWithoutDocs")(function* (docsUrl: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "envi-no-docs-" });
  const copy = path.join(directory, "envi");
  const app = path.join(directory, "app");
  const manifest = { ...enviManifest, config: { ...enviManifest.config, docsUrl } };

  yield* fs.makeDirectory(copy);
  yield* fs.makeDirectory(app);
  yield* fs.copy(path.join(enviFolder, "dist"), path.join(copy, "dist"));
  yield* fs.writeFileString(path.join(copy, "package.json"), JSON.stringify(manifest));
  yield* fs.symlink(path.join(enviFolder, "node_modules"), path.join(copy, "node_modules"));

  return { app, bin: path.join(copy, "dist", "bin.js"), docs: path.join(copy, "docs") };
});

/** An empty folder: `envi docs` needs no config. */
const emptyFolder = Effect.flatMap(FileSystem.FileSystem, (fs) =>
  fs.makeTempDirectoryScoped({ prefix: "envi-docs-" }),
);

layer(NodeServices.layer, { excludeTestServices: true })("envi docs", (it) => {
  describe.each(runtimes)("on %s", (runtime) => {
    it.effect("prints the index page, which maps each task to a page", () =>
      Effect.gen(function* () {
        const pages = yield* sourcePages;
        const index = pages.find((page) => page.page === "README");
        const result = yield* runCli(runtime, yield* emptyFolder, ["docs"]);

        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout.trim()).toBe(index?.body.trim());
      }),
    );

    it.effect("lists every page with its title and description", () =>
      Effect.gen(function* () {
        const pages = yield* sourcePages;
        const result = yield* runCli(runtime, yield* emptyFolder, ["docs", "list", "--json"]);
        const report = yield* decodeJson(DocsListReport, result.stdout);

        expect(report.pages).toEqual(
          pages.map(({ page, title, description }) => ({ page, title, description })),
        );
      }),
    );

    it.effect("shows one page by its name, its file name, or the docs link of an error", () =>
      Effect.gen(function* () {
        const folder = yield* emptyFolder;
        const page = "errors/secret-reference-not-found";
        const source = (yield* sourcePages).find((entry) => entry.page === page);

        const outputs = yield* Effect.forEach(
          [page, `${page}${pageSuffix}`, docsOf("secret-reference-not-found")],
          (name) => runCli(runtime, folder, ["docs", "show", name]),
        );

        expect(outputs.map((output) => output.stdout.trim())).toEqual(
          outputs.map(() => source?.body.trim()),
        );
      }),
    );

    it.effect("shows a page as JSON with the path of its file", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const source = (yield* sourcePages).find((entry) => entry.page === "cache");

        const result = yield* runCli(runtime, yield* emptyFolder, [
          "docs",
          "show",
          "cache",
          "--json",
        ]);

        const report = yield* decodeJson(DocsPageReport, result.stdout);

        expect(report).toEqual({
          page: source?.page,
          title: source?.title,
          description: source?.description,
          path: report.path,
          text: source?.body,
        });
        expect(yield* fs.readFileString(report.path)).toContain(source?.body);
      }),
    );

    it.effect("rejects a page that does not exist, and names no file outside the docs", () =>
      Effect.gen(function* () {
        const folder = yield* emptyFolder;
        const missing = yield* runCli(runtime, folder, ["docs", "show", "../package", "--json"]);
        const existing = yield* runCli(runtime, folder, ["docs", "show", "cache", "--json"]);
        const error = yield* decodeJson(ErrorReport, missing.stdout);

        expect(missing.exitCode).toBe(1);
        expect(error.error).toMatchObject({ error: "DocsError", reason: "NotFound" });
        expect(existing.exitCode, existing.stderr).toBe(0);
      }),
    );

    it.effect("finds the pages that hold every word of a search, title matches first", () =>
      Effect.gen(function* () {
        const pages = yield* sourcePages;
        const target = pages.find((entry) => entry.page === "errors/secret-reference-not-found");
        const words = (target?.title ?? "").toLowerCase().split(/\s+/u);

        const result = yield* runCli(runtime, yield* emptyFolder, [
          "docs",
          "search",
          ...words,
          "--json",
        ]);

        const report = yield* decodeJson(DocsSearchReport, result.stdout);

        const matches = pages.filter((entry) => {
          const text = `${entry.title}\n${entry.description}\n${entry.body}`.toLowerCase();

          return words.every((word) => text.includes(word));
        });

        expect(report.pages[0]?.page).toBe(target?.page);
        expect(report.pages.map((entry) => entry.page).toSorted()).toEqual(
          matches.map((entry) => entry.page).toSorted(),
        );
      }),
    );

    it.effect("reads the index and a page from GitHub at the tag of its version without docs", () =>
      Effect.gen(function* () {
        const docsUrl = yield* docsServerUrl;
        const envi = yield* packageWithoutDocs(docsUrl);
        const pages = yield* sourcePages;

        const docs = (args: ReadonlyArray<string>) =>
          runProcess(runtime, [envi.bin, "docs", ...args], envi.app);

        const index = yield* docs([]);
        const shown = yield* docs(["show", "cache", "--json"]);
        const list = yield* docs(["list", "--json"]);
        const page = yield* decodeJson(DocsPageReport, shown.stdout);

        expect(index.stdout.trim()).toBe(
          pages.find((entry) => entry.page === "README")?.body.trim(),
        );
        expect(page.text).toBe(pages.find((entry) => entry.page === "cache")?.body);
        expect(page.path).toBe(
          `${docsUrl.replace(versionPlaceholder, enviVersion)}cache${pageSuffix}`,
        );
        expect((yield* decodeJson(ErrorReport, list.stdout)).error).toMatchObject({
          error: "DocsError",
          reason: "Unreadable",
        });
      }),
    );

    it.effect(
      "DocsError Unreadable: the docs folder is missing or empty, and GitHub does not answer",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const envi = yield* packageWithoutDocs(yield* closedDocsUrl);
          const show = runProcess(runtime, [envi.bin, "docs", "show", "cache", "--json"], envi.app);
          const missing = yield* show;
          const path = yield* runProcess(runtime, [envi.bin, "docs", "path", "--json"], envi.app);

          yield* fs.makeDirectory(envi.docs);
          const empty = yield* show;

          yield* fs.remove(envi.docs, { recursive: true });
          yield* fs.copy(content, envi.docs);
          const complete = yield* show;

          const reasons = yield* Effect.forEach([missing, path, empty], (result) =>
            Effect.map(decodeJson(ErrorReport, result.stdout), (report) => report.error.reason),
          );

          expect(reasons).toEqual(["Unreadable", "Unreadable", "Unreadable"]);
          expect(complete.exitCode, complete.stderr).toBe(0);
        }),
    );

    it.effect("shows a good page when another page is broken, and fails the list", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const envi = yield* packageWithoutDocs(yield* closedDocsUrl);

        yield* fs.copy(content, envi.docs);
        yield* fs.writeFileString(path.join(envi.docs, "broken.md"), "# No frontmatter\n");

        const show = yield* runProcess(runtime, [envi.bin, "docs", "show", "cache"], envi.app);
        const list = yield* runProcess(runtime, [envi.bin, "docs", "list", "--json"], envi.app);
        const source = (yield* sourcePages).find((entry) => entry.page === "cache");

        expect(show.stdout.trim()).toBe(source?.body.trim());
        expect((yield* decodeJson(ErrorReport, list.stdout)).error).toMatchObject({
          error: "DocsError",
          reason: "Unreadable",
        });
      }),
    );

    it.effect("prints the folder of the docs and the file of one page", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const folder = yield* emptyFolder;
        const pages = yield* sourcePages;
        const root = yield* runCli(runtime, folder, ["docs", "path", "--json"]);
        const page = yield* runCli(runtime, folder, ["docs", "path", "cache"]);
        const docsFolder = (yield* decodeJson(DocsPathReport, root.stdout)).path;

        const shipped = (yield* fs.readDirectory(docsFolder, { recursive: true }))
          .filter((name) => name.endsWith(pageSuffix))
          .map((name) => name.slice(0, -pageSuffix.length))
          .toSorted();

        expect(shipped).toEqual(pages.map((entry) => entry.page).toSorted());
        expect(page.stdout.trim()).toBe(path.join(docsFolder, `cache${pageSuffix}`));
      }),
    );
  });
});
