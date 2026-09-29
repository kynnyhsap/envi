// The agent skills in `skills/` at the repo root. `npx skills add` installs them from the repo, and
// the npm package of Envi ships them, so each skill must follow the Agent Skills spec of
// https://agentskills.io/specification.
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Frontmatter from "./core/Frontmatter.ts";

const skillsFolder = new URL("../../../skills/", import.meta.url).pathname;

const skillFile = "SKILL.md";

/** The spec: lowercase letters and digits, with single hyphens between them. */
const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const maxNameLength = 64;

const maxDescriptionLength = 1024;

/** The spec asks for a body under 500 lines, and moves the details into other files. */
const maxBodyLines = 500;

const parseSkill = Frontmatter.parser(
  Schema.Struct({
    name: Schema.String.check(Schema.isPattern(skillName), Schema.isMaxLength(maxNameLength)),
    description: Schema.NonEmptyString.check(Schema.isMaxLength(maxDescriptionLength)),
  }),
);

/** Every skill: its folder and its parsed `SKILL.md`. */
const skills = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const folders = yield* fs.readDirectory(skillsFolder);

  return yield* Effect.forEach(folders.toSorted(), (folder) =>
    Effect.map(fs.readFileString(`${skillsFolder}${folder}/${skillFile}`), (text) => ({
      folder,
      skill: parseSkill(text),
    })),
  );
}).pipe(Effect.provide(NodeFileSystem.layer));

describe("agent skills", () => {
  it.effect("gives every skill a valid name that matches its folder, and a valid description", () =>
    Effect.gen(function* () {
      const found = yield* skills;

      expect(found.map(({ skill }) => Option.map(skill, ({ fields }) => fields.name))).toEqual(
        found.map(({ folder }) => Option.some(folder)),
      );
    }),
  );

  it.effect("keeps the body of every skill under the line limit of the spec", () =>
    Effect.gen(function* () {
      const found = yield* skills;

      const long = found.flatMap(({ folder, skill }) =>
        Option.match(skill, {
          onNone: () => [],
          onSome: ({ body }) => (body.split("\n").length < maxBodyLines ? [] : [folder]),
        }),
      );

      expect(long).toEqual([]);
    }),
  );
});
