// The name, the version, and the runtime floors of Envi come from its manifest. Code never spells
// them, so a rename or a release changes only the manifest. `scripts/packages.ts` holds the names
// of the workspace, and the root manifest holds the version and the floors.
import manifest from "../../package.json" with { type: "json" };

/** The npm name of Envi, such as in an install hint. */
export const name: string = manifest.name;

/** The version of Envi. `envi --version` prints it. */
export const version: string = manifest.version;

/** The lowest Node version that imports a TypeScript file without a flag. */
export const minimumNodeVersion: string = manifest.engines.node.replace(">=", "");

/** The lowest Bun version that Envi supports. */
export const minimumBunVersion: string = manifest.engines.bun.replace(">=", "");
