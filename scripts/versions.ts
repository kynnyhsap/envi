// Keeps every version of the workspace in one place.
//
// - The root manifest holds the version. Every package has that version, the way the Effect v4
//   packages share one version. A provider asks for `workspace:^` Envi as its peer.
// - The `engines` of the root manifest hold the runtime floors. Every package has those `engines`,
//   the READMEs name the floors, and the `floors` job of CI tests them.
// - `workspaces.catalog` holds every dependency version. A package manifest uses only `catalog:`
//   and `workspace:` specs. `effect` and every `@effect/*` entry share one version.
// - The READMEs ask for the `effect` range of the catalog.
//
//   bun run versions           writes the root version and engines into every package, and the
//                              range and the floors into the READMEs
//   bun run versions --check   fails when a file differs or a rule breaks, without a change
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess } from "effect/unstable/process";
import { fileURLToPath } from "node:url";

import { packageNames } from "./packages.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

const Dependencies = Schema.optional(Schema.Record(Schema.String, Schema.String));

const Engines = Schema.Struct({ bun: Schema.String, node: Schema.String });

const PackageManifest = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    version: Schema.String,
    dependencies: Dependencies,
    devDependencies: Dependencies,
    peerDependencies: Dependencies,
    engines: Engines,
  }),
);

const RootManifest = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.String,
    devDependencies: Dependencies,
    engines: Engines,
    workspaces: Schema.Struct({ catalog: Schema.Record(Schema.String, Schema.String) }),
  }),
);

type PackageManifest = typeof PackageManifest.Type;

const dependencyKinds = ["dependencies", "devDependencies", "peerDependencies"] as const;

const Spec = {
  Catalog: "catalog:",
  Workspace: "workspace:*",
  WorkspacePeer: "workspace:^",
} as const;

/** An `effect` spec in a README, such as `effect@^4.0.0-rc.117`. */
const effectSpec = /(?<![\w@/-])effect@[^\s"'`]+/gu;

/** A runtime floor in a README, such as `Node 22.19.0`. */
const floor = (runtime: string) => new RegExp(`\\b${runtime} \\d+\\.\\d+\\.\\d+`, "gu");

/** The `engines` block of a manifest, formatted the way oxfmt formats a manifest. */
const enginesBlock = (engines: typeof Engines.Type): string =>
  `"engines": ${JSON.stringify(engines, null, 2).replaceAll("\n", "\n  ")}`;

class VersionsError extends Data.TaggedError("VersionsError")<{ readonly detail: string }> {
  override get message(): string {
    return `The version check failed:\n${this.detail}`;
  }
}

interface Dependency {
  readonly file: string;
  readonly kind: (typeof dependencyKinds)[number];
  readonly name: string;
  readonly spec: string;
}

const dependenciesOf = (
  file: string,
  manifest: Pick<PackageManifest, (typeof dependencyKinds)[number]>,
): ReadonlyArray<Dependency> =>
  dependencyKinds.flatMap((kind) =>
    Object.entries(manifest[kind] ?? {}).map(([name, spec]) => ({ file, kind, name, spec })),
  );

/** The rules that no script can fix. Each problem is one line. */
const specProblems = (
  packages: ReadonlyArray<Dependency>,
  rootDependencies: ReadonlyArray<Dependency>,
  workspaceNames: ReadonlySet<string>,
  catalog: Readonly<Record<string, string>>,
): ReadonlyArray<string> => {
  const packageDependencyNames = new Set(packages.map((dependency) => dependency.name));

  const expectedSpec = (dependency: Dependency): string | undefined => {
    if (workspaceNames.has(dependency.name)) {
      return dependency.kind === "peerDependencies" ? Spec.WorkspacePeer : Spec.Workspace;
    }

    return packageDependencyNames.has(dependency.name) ? Spec.Catalog : undefined;
  };

  const wrongSpecs = [...packages, ...rootDependencies].flatMap((dependency) => {
    const expected = expectedSpec(dependency) ?? dependency.spec;

    return dependency.spec === expected
      ? []
      : [
          `${dependency.file}: ${dependency.kind} ${dependency.name} is "${dependency.spec}". Use "${expected}".`,
        ];
  });

  const effectVersions = new Set(
    Object.entries(catalog)
      .filter(([name]) => name === "effect" || name.startsWith("@effect/"))
      .map(([, version]) => version.replace(/^\^/u, "")),
  );

  const effectProblems =
    effectVersions.size > 1
      ? [
          `package.json: the catalog has several Effect versions: ${[...effectVersions].join(", ")}. Use one.`,
        ]
      : [];

  return [...wrongSpecs, ...effectProblems];
};

/** A file whose text differs from the text that the rules give it. */
interface Rewrite {
  readonly file: string;
  readonly text: string;
}

/** Runs a command in the repo root with the output of this process. */
const exec = (command: string, args: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(command, args, {
        cwd: root,
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
      });

      const exitCode = yield* handle.exitCode;

      return yield* exitCode === 0
        ? Effect.void
        : Effect.fail(new VersionsError({ detail: `${command} exited with ${exitCode}.` }));
    }),
  );

/** The READMEs in git. The prepack copy of the root README in `packages/envi` is ignored. */
const trackedReadmes = Effect.scoped(
  Effect.gen(function* () {
    const handle = yield* ChildProcess.make("git", ["ls-files", "-z", "README.md", "*/README.md"], {
      cwd: root,
    });

    const output = yield* Stream.mkString(Stream.decodeText(handle.stdout));

    return output.split("\0").filter((file) => file !== "");
  }),
);

const check = Flag.Boolean("check").pipe(
  Flag.withDescription("Fail when a file differs or a rule breaks, without a change."),
  Flag.withDefault(false),
);

const command = Command.make("versions", { check }, (input) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folders = Object.keys(packageNames);

    const rootManifest = yield* fs
      .readFileString(path.join(root, "package.json"))
      .pipe(Effect.flatMap(Schema.decodeEffect(RootManifest)));

    const packages = yield* Effect.forEach(folders, (folder) =>
      Effect.gen(function* () {
        const file = path.join(folder, "package.json");
        const text = yield* fs.readFileString(path.join(root, file));
        const manifest = yield* Schema.decodeEffect(PackageManifest)(text);

        return { folder, file, text, manifest };
      }),
    );

    const problems = specProblems(
      packages.flatMap((item) => dependenciesOf(item.file, item.manifest)),
      dependenciesOf("package.json", rootManifest),
      new Set(packages.map((item) => item.manifest.name)),
      rootManifest.workspaces.catalog,
    );

    const effectRange = rootManifest.workspaces.catalog["effect"] ?? "";
    const { engines } = rootManifest;

    const manifestRewrites: ReadonlyArray<Rewrite> = packages
      .map((item) => ({
        file: item.file,
        text: item.text,
        rewritten: item.text
          .replace(/"version": "[^"]*"/u, `"version": "${rootManifest.version}"`)
          .replace(/"engines": \{[^}]*\}/u, enginesBlock(engines)),
      }))
      .filter((item) => item.rewritten !== item.text)
      .map((item) => ({ file: item.file, text: item.rewritten }));

    const readmes = yield* trackedReadmes;

    const readmeRewrites = yield* Effect.forEach(readmes, (file) =>
      Effect.map(fs.readFileString(path.join(root, file)), (text) => ({
        file,
        text,
        rewritten: text
          .replace(effectSpec, `effect@${effectRange}`)
          .replace(floor("Node"), `Node ${engines.node.replace(">=", "")}`)
          .replace(floor("Bun"), `Bun ${engines.bun.replace(">=", "")}`),
      })),
    );

    const rewrites: ReadonlyArray<Rewrite> = [
      ...manifestRewrites,
      ...readmeRewrites
        .filter((readme) => readme.rewritten !== readme.text)
        .map((readme) => ({ file: readme.file, text: readme.rewritten })),
    ];

    if (input.check) {
      const all = [
        ...problems,
        ...rewrites.map(
          (rewrite) =>
            `${rewrite.file}: differs from the root manifest or the catalog. Run \`bun run versions\`.`,
        ),
      ];

      return yield* all.length === 0
        ? Console.log("Every version comes from the root manifest and the catalog.")
        : Effect.fail(new VersionsError({ detail: all.join("\n") }));
    }

    yield* Effect.forEach(rewrites, (rewrite) =>
      fs.writeFileString(path.join(root, rewrite.file), rewrite.text),
    );

    if (manifestRewrites.length > 0) {
      yield* exec(process.execPath, ["install"]);
    }

    yield* Console.log(`Wrote ${rewrites.length} files.`);

    return yield* problems.length === 0
      ? Effect.void
      : Effect.fail(new VersionsError({ detail: problems.join("\n") }));
  }),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
