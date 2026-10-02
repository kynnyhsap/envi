// The rules of the docs pages in `packages/docs/content`. The npm package of Envi ships the pages,
// `envi docs` reads them, and the website will serve them, so each page must stand on its own.
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as Docs from "./Docs.ts";
import * as Package from "./Package.ts";

const content = new URL("../../../docs/content/", import.meta.url).pathname;

/** A relative link to a page, such as `](../cache.md)` or `](./errors/vars.md#usage)`. */
const relativeLink = /\]\((?<target>(?!https?:)[^)\s#]+\.md)(?:#[^)\s]*)?\)/gu;

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, FetchHttpClient.layer);

describe("Docs", () => {
  it.effect("starts the text of every page with its title as the heading", () =>
    Effect.gen(function* () {
      const pages = yield* Docs.Docs.use((docs) => docs.list);

      expect(
        pages.filter((page) => !page.text.startsWith(`# ${page.title}\n`)).map((page) => page.page),
      ).toEqual([]);
    }).pipe(Effect.provide(Docs.layer(content, Package.docsUrl)), Effect.provide(platform)),
  );

  it.effect("links only to pages that exist", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const pages = yield* Docs.Docs.use((docs) => docs.list);
      const files = new Set(pages.map((page) => `${page.page}${Docs.pageSuffix}`));

      const broken = pages.flatMap((page) =>
        [...page.text.matchAll(relativeLink)].flatMap((link) => {
          const target = path.join(path.dirname(page.page), link.groups?.["target"] ?? "");

          return files.has(target) ? [] : [`${page.page} -> ${target}`];
        }),
      );

      expect(broken).toEqual([]);
    }).pipe(Effect.provide(Docs.layer(content, Package.docsUrl)), Effect.provide(platform)),
  );
});
