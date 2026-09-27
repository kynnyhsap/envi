// Publishes every package of the workspace at the root version. The `release` workflow runs it
// when a tag `v<version>` arrives.
//
// - The Bun of the workspace packs each package, because only Bun resolves the `catalog:` and
//   `workspace:` specs. `tests/e2e/package.test.ts` packs and tests the same way.
// - npm publishes each tarball, because only npm signs a provenance statement and supports
//   trusted publishing. The workflow sets `NPM_CONFIG_PROVENANCE`.
// - Envi goes first, because the provider asks for it as a peer. A package that the registry has
//   at this version stays as it is, so a second run finishes a failed release.
//
//   bun run release --tag v1.0.0             publishes, and fails when the tag differs from
//                                            the root version
//   bun run release --tag v1.0.0 --dry-run   packs and runs `npm publish --dry-run`
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess } from "effect/unstable/process";
import { fileURLToPath } from "node:url";

import rootManifest from "../package.json" with { type: "json" };
import { packageNames } from "./packages.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

/** The answer of `npm view <name>@<version> version --json` when the registry has the version. */
const Published = Schema.fromJsonString(Schema.String);

/** The answer of `npm view` when the registry has no such package or version. */
const NotFound = Schema.fromJsonString(
  Schema.Struct({ error: Schema.Struct({ code: Schema.Literal("E404") }) }),
);

class ReleaseError extends Data.TaggedError("ReleaseError")<{ readonly detail: string }> {
  override get message(): string {
    return `The release failed: ${this.detail}`;
  }
}

/** Runs a command, and returns its exit code and its output. */
const run = (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  stderr: "inherit" | "ignore" = "inherit",
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(command, args, { cwd, stdin: "ignore", stderr });

      const [exitCode, stdout] = yield* Effect.all(
        [handle.exitCode, Stream.mkString(Stream.decodeText(handle.stdout))],
        { concurrency: "unbounded" },
      );

      return { exitCode, stdout };
    }),
  );

/** Runs a command, and fails when it exits with an error. */
const exec = Effect.fn("exec")(function* (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
) {
  const result = yield* run(command, args, cwd);

  return yield* result.exitCode === 0
    ? Effect.succeed(result.stdout)
    : Effect.fail(
        new ReleaseError({ detail: `${command} ${args[0]} exited with ${result.exitCode}.` }),
      );
});

/** Whether the registry has the package at the version. Any error other than E404 fails. */
const isPublished = Effect.fn("isPublished")(function* (name: string, version: string) {
  // The answer holds the error, so the error text of npm stays out of the log.
  const result = yield* run(
    "npm",
    ["view", `${name}@${version}`, "version", "--json"],
    root,
    "ignore",
  );

  if (Option.isSome(Schema.decodeUnknownOption(Published)(result.stdout))) {
    return true;
  }

  return yield* Option.isSome(Schema.decodeUnknownOption(NotFound)(result.stdout))
    ? Effect.succeed(false)
    : Effect.fail(new ReleaseError({ detail: `npm view ${name} exited with ${result.exitCode}.` }));
});

/** Packs one package with the Bun of the workspace, and publishes the tarball with npm. */
const publish = Effect.fn("publish")(function* (folder: string, tarballs: string, dryRun: boolean) {
  const path = yield* Path.Path;

  const packed = yield* exec(
    process.execPath,
    ["pm", "pack", "--destination", tarballs, "--quiet"],
    path.join(root, folder),
  );

  return yield* exec("npm", ["publish", packed.trim(), ...(dryRun ? ["--dry-run"] : [])], root);
});

const tag = Flag.String("tag").pipe(
  Flag.withDescription("The git tag of the release. It must be v and the root version."),
);

const dryRun = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("Pack, and run `npm publish --dry-run` in place of a publish."),
  Flag.withDefault(false),
);

const command = Command.make("release", { tag, dryRun }, (input) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { version } = rootManifest;

    if (input.tag !== `v${version}`) {
      return yield* new ReleaseError({
        detail: `the tag ${input.tag} differs from the root version ${version}. Tag v${version}.`,
      });
    }

    const tarballs = yield* fs.makeTempDirectoryScoped({ prefix: "envi-release-" });

    return yield* Effect.forEach(
      Object.entries(packageNames),
      ([folder, name]) =>
        Effect.flatMap(isPublished(name, version), (published) =>
          published
            ? Console.log(`${name}@${version} is on the registry already.`)
            : publish(folder, tarballs, input.dryRun),
        ),
      { discard: true },
    );
  }),
);

Command.run(command, { version: rootManifest.version }).pipe(
  Effect.scoped,
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
