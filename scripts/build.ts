// Builds the package in the working directory. Each package runs it with Bun through
// `bun run build`: poof removes `dist`, then tsc compiles `src` into a new `dist`.
import * as Effect from "effect/Effect";

import { exec, root, runScript } from "./Workspace.ts";

/** The binaries of the workspace, so the script runs without `bun run` on the `PATH`. */
const binary = (name: string): string => `${root}node_modules/.bin/${name}`;

const cwd = process.cwd();

runScript(
  Effect.gen(function* () {
    yield* exec(binary("poof"), ["dist"], cwd);
    yield* exec(binary("tsc"), ["-p", "tsconfig.build.json"], cwd);
  }),
);
