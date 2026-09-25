/**
 * The npm names of the workspace packages, by folder. This is the one place to change a name:
 * edit it here, then run `bun run rename`. `bun run check` fails while a manifest differs.
 * Code never spells a name: each package reads its own name from its manifest.
 */
export const packageNames = {
  "packages/envi": "@kynnyhsap/envi",
  "packages/onepassword": "@kynnyhsap/envi-1password",
} as const;
