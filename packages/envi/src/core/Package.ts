// The name and the version of Envi come from its manifest. Code never spells the npm name, so a
// rename changes only the manifest. `scripts/packages.ts` holds the names of the workspace.
import manifest from "../../package.json" with { type: "json" };

/** The npm name of Envi, such as in an install hint. */
export const name: string = manifest.name;

/** The version of Envi. `envi --version` prints it. */
export const version: string = manifest.version;
