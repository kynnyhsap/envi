// The published packages. The test packs both packages the way `bun publish` does, installs the
// tarballs into a fresh project with npm and with Bun, and uses them there as a user does: the
// command, the SDK, and the types. The install reads the dependencies from the npm registry.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { fileURLToPath } from "node:url";

import enviManifest from "../../packages/envi/package.json" with { type: "json" };
import onePasswordManifest from "../../packages/onepassword/package.json" with { type: "json" };
import { runProcess } from "./helpers.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const tsc = fileURLToPath(new URL("../../node_modules/.bin/tsc", import.meta.url));

const packages = [
  { folder: "packages/envi", manifest: enviManifest },
  { folder: "packages/onepassword", manifest: onePasswordManifest },
] as const;

/** The install command of both READMEs. It asks for the peer range of `effect`. */
const readmeInstall = `bun add ${enviManifest.name} ${onePasswordManifest.name} "effect@${enviManifest.peerDependencies.effect}"`;

/** The file name that `npm pack` and `bun pm pack` give a tarball. */
const tarballName = (manifest: { readonly name: string; readonly version: string }) =>
  `${manifest.name.replace("@", "").replace("/", "-")}-${manifest.version}.tgz`;

const installers = [
  { manager: "npm", runtime: "node", install: ["npm", "install", "--no-audit", "--no-fund"] },
  { manager: "bun", runtime: "bun", install: ["bun", "install"] },
] as const;

type Installer = (typeof installers)[number];

const secretValue = "postgres://packaged";

/**
 * The manifest of the fresh project. Bun looks up the peer of the provider on the registry, and
 * the registry has no Envi before the first publish. The override points that peer at the tarball.
 */
const projectManifest = (tarballs: string) => {
  const [envi, onePassword] = packages.map(
    (item) => `file:${tarballs}/${tarballName(item.manifest)}`,
  );

  return JSON.stringify({
    name: "app",
    private: true,
    type: "module",
    dependencies: {
      [enviManifest.name]: envi,
      [onePasswordManifest.name]: onePassword,
      effect: enviManifest.peerDependencies.effect,
    },
    overrides: { [enviManifest.name]: envi },
  });
};

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "nodenext",
      moduleResolution: "nodenext",
      target: "ES2023",
      lib: ["ES2023", "DOM"],
      types: [],
      skipLibCheck: true,
      noEmit: true,
      allowImportingTsExtensions: true,
    },
  }),
  "envi.config.ts": `import { defineConfig } from "${enviManifest.name}";
import { memoryProvider } from "${enviManifest.name}/testing";
import { onePasswordProvider, op } from "${onePasswordManifest.name}";

export default defineConfig({
  providers: [memoryProvider({ "db/url": "${secretValue}" }), onePasswordProvider()],
  cache: false,
  vars: ({ mem }) => ({
    PORT: "3000",
    DATABASE_URL: mem("db/url"),
  }),
});

/** No command resolves this reference. It proves that the provider package loads. */
export const stripeKey = op("payments", "stripe", "secret-key");
`,
  "load.ts": `import { createEnvi, type Env } from "${enviManifest.name}";
import config from "./envi.config.ts";

const env: Env<typeof config> = await createEnvi(config).load();
const url: string = env.DATABASE_URL;

// @ts-expect-error The config has no such var. An untyped package would accept it.
env.MISSING;

console.log(JSON.stringify({ PORT: env.PORT, DATABASE_URL: url }));
`,
};

/** Runs a command, and fails with its output when it exits with an error. */
const exec = Effect.fn("exec")(function* (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
) {
  const result = yield* runProcess(command, args, cwd);

  return yield* result.exitCode === 0
    ? Effect.succeed(result)
    : Effect.fail(
        new Error(`${command} ${args.join(" ")} exited with ${result.exitCode}\n${result.stderr}`),
      );
});

/** The folder of a fresh project that installed both tarballs. */
class Project extends Context.Service<Project, string>()("Project") {}

const installedProject = (installer: Installer) =>
  Layer.effect(
    Project,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "envi-package-" });
      const tarballs = path.join(directory, "tarballs");
      const project = path.join(directory, "app");

      yield* fs.makeDirectory(project);
      yield* Effect.forEach(packages, (item) =>
        exec("bun", ["pm", "pack", "--destination", tarballs], path.join(repoRoot, item.folder)),
      );
      yield* Effect.forEach(Object.entries(files), ([name, text]) =>
        fs.writeFileString(path.join(project, name), text),
      );
      yield* fs.writeFileString(path.join(project, "package.json"), projectManifest(tarballs));
      yield* exec(installer.install[0], installer.install.slice(1), project);

      return project;
    }),
  );

layer(NodeServices.layer, { excludeTestServices: true })("the install command", (it) => {
  it.effect.each(["README.md", "packages/onepassword/README.md"])(
    "%s installs the peer range of effect",
    (file) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const readme = yield* fs.readFileString(`${repoRoot}/${file}`);

        expect(readme).toContain(readmeInstall);
      }),
  );
});

describe.each(installers)("the published packages installed with $manager", (installer) => {
  layer(installedProject(installer).pipe(Layer.provideMerge(NodeServices.layer)), {
    excludeTestServices: true,
    timeout: "3 minutes",
  })((it) => {
    it.effect.each(packages)("holds only the files that $manifest.name needs", (item) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const project = yield* Project;
        const folder = path.join(project, "node_modules", ...item.manifest.name.split("/"));
        const names = yield* fs.readDirectory(folder, { recursive: true });
        const manifest = yield* fs.readFileString(path.join(folder, "package.json"));

        expect(names).toEqual(
          expect.arrayContaining([
            "LICENSE",
            "README.md",
            "dist/index.js",
            "dist/index.d.ts",
            "dist/index.d.ts.map",
            "src/index.ts",
          ]),
        );
        expect(names.filter((name) => /\.test\.ts$|fixtures/.test(name))).toEqual([]);
        expect(manifest).not.toMatch(/"(?:workspace|catalog):/);
      }),
    );

    it.effect("asks for a compatible Envi as the peer of the provider", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const project = yield* Project;
        const folder = path.join(project, "node_modules", ...onePasswordManifest.name.split("/"));
        const manifest = JSON.parse(yield* fs.readFileString(path.join(folder, "package.json")));

        expect(manifest.peerDependencies[enviManifest.name]).toBe(`^${enviManifest.version}`);
      }),
    );

    it.effect("runs the envi command", () =>
      Effect.gen(function* () {
        const project = yield* Project;

        const envi = (args: ReadonlyArray<string>) =>
          runProcess(installer.runtime, ["node_modules/.bin/envi", ...args], project);

        const version = yield* envi(["--version"]);
        const check = yield* envi(["check"]);
        const exported = yield* envi(["export", "--format", "json", "--no-redact"]);

        expect(version.stdout).toContain(enviManifest.version);
        expect(check.exitCode, check.stderr).toBe(0);
        expect(exported.exitCode, exported.stderr).toBe(0);
        expect(JSON.parse(exported.stdout)).toEqual({ PORT: "3000", DATABASE_URL: secretValue });
      }),
    );

    it.effect("loads the config through the SDK", () =>
      Effect.gen(function* () {
        const project = yield* Project;
        const result = yield* runProcess(installer.runtime, ["load.ts"], project);

        expect(result.exitCode, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ PORT: "3000", DATABASE_URL: secretValue });
      }),
    );

    it.effect("type checks against the published declarations", () =>
      Effect.gen(function* () {
        const project = yield* Project;
        const result = yield* runProcess(tsc, ["-p", "tsconfig.json"], project);

        expect(result.exitCode, result.stdout).toBe(0);
      }),
    );
  });
});
