// The text form of each report. `--json` prints the encoded report instead.
import {
  type CacheClearReport,
  type CacheListReport,
  type CheckReport,
  type DocsListReport,
  type DocsPage,
  type DocsSearchReport,
  type DoctorReport,
  type FindReport,
  type InspectReport,
  type SyncReport,
  redactedText,
  ValueOrigin,
  type VarFailure,
} from "./core/Reports.ts";

/** The text that stands for an absent cell. */
const absent = "-";

/** Aligns rows as columns with two spaces between them. The last column has no padding. */
const table = (rows: ReadonlyArray<ReadonlyArray<string>>): ReadonlyArray<string> => {
  const widths = rows.reduce<ReadonlyArray<number>>(
    (current, row) => row.map((cell, index) => Math.max(current[index] ?? 0, cell.length)),
    [],
  );

  return rows.map((row) =>
    row
      .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
      .join("  "),
  );
};

/** A failed var: what failed, the config file when it is known, the next action, and the docs. */
const failureLines = (failure: VarFailure): ReadonlyArray<string> => [
  `  ✗ ${failure.key}: ${failure.summary}`,
  ...(failure.config === null ? [] : [`    config: ${failure.config}`]),
  `    hint: ${failure.hint}`,
  `    docs: ${failure.docs}`,
];

const lines = (parts: ReadonlyArray<string>): string => `${parts.join("\n")}\n`;

/** The text of `envi sync`. */
export const sync = (report: SyncReport): string =>
  lines([
    `Synced the stage ${report.stage} from ${report.configs} ${report.configs === 1 ? "config" : "configs"} in ${report.durationMillis} ms.`,
    ...report.providers.map(
      (entry) =>
        `  ${entry.provider}: ${entry.secrets} secrets, ${entry.cached} cached, ${entry.resolved} resolved`,
    ),
    ...(report.cache ? [] : ["The cache is off, so the next run resolves every secret again."]),
    ...(report.failures.length === 0
      ? []
      : [
          `${report.failures.length} ${report.failures.length === 1 ? "var" : "vars"} failed:`,
          ...report.failures.flatMap(failureLines),
        ]),
  ]);

/** The text of `envi check`. */
export const check = (report: CheckReport): string =>
  lines([
    `Stage: ${report.stage}`,
    ...report.passed.map((key) => `  ✓ ${key}`),
    ...report.failures.flatMap(failureLines),
  ]);

/** The text of `envi inspect`. */
export const inspect = (report: InspectReport): string =>
  lines([
    `Stage: ${report.stage}`,
    ...table([
      ["KEY", "ORIGIN", "REFERENCE", "VALUE"],
      ...report.vars.map((entry) => [
        entry.key,
        entry.origin,
        entry.reference ?? absent,
        entry.origin !== ValueOrigin.Unset && entry.redacted
          ? redactedText
          : (entry.value ?? absent),
      ]),
    ]),
  ]);

/** The text of `envi find`. */
export const find = (report: FindReport): string =>
  lines([
    ...report.queries.flatMap((entry) => [
      entry.query,
      ...(entry.references.length === 0
        ? ["  no match"]
        : entry.references.map((found) => `  ${found.reference}`)),
    ]),
    ...(report.skipped.length === 0
      ? []
      : [`These providers cannot search: ${report.skipped.join(", ")}.`]),
  ]);

/** The text of `envi cache list`. */
export const cacheList = (report: CacheListReport): string =>
  report.entries.length === 0
    ? lines(["The cache holds no entry."])
    : lines([
        `Directory: ${report.directory ?? absent}`,
        ...table([
          ["PROVIDER", "REFERENCE", "RESOLVED"],
          ...report.entries.map((entry) => [entry.provider, entry.reference, entry.resolvedAt]),
        ]),
      ]);

/** The text of `envi cache clear`. */
export const cacheClear = (report: CacheClearReport): string =>
  lines([`Removed ${report.removed} cache ${report.removed === 1 ? "entry" : "entries"}.`]);

/** Each page and its description, with a line that says how to read one. */
const docsPages = (pages: ReadonlyArray<DocsPage>): ReadonlyArray<string> => [
  ...table([["PAGE", "DESCRIPTION"], ...pages.map((page) => [page.page, page.description])]),
  "Read a page with `envi docs show <page>`.",
];

/** The text of `envi docs list`. */
export const docsList = (report: DocsListReport): string =>
  lines([`Folder: ${report.folder}`, ...docsPages(report.pages)]);

/** The text of `envi docs search`. */
export const docsSearch = (report: DocsSearchReport): string =>
  report.pages.length === 0
    ? lines([`No page holds every word of "${report.query}". Run \`envi docs list\`.`])
    : lines(docsPages(report.pages));

/** `yes` or `no`. */
const yesNo = (value: boolean): string => (value ? "yes" : "no");

/** The text of `envi doctor`. */
export const doctor = (report: DoctorReport): string =>
  lines(
    table([
      ["Envi", report.version],
      ["Runtime", `${report.runtime.name} ${report.runtime.version}`],
      ["Platform", `${report.platform} ${report.arch}`],
      ["CI", yesNo(report.ci)],
      ["Configs", `${report.configs.up} up from here, ${report.configs.repo} in the repo`],
      ["Cache directory", yesNo(report.cacheDirectory)],
      [
        "Keychain",
        report.keychain.command === null
          ? report.keychain.store
          : `${report.keychain.store}, command on PATH: ${yesNo(report.keychain.command)}`,
      ],
      ["Variables", report.variables.length === 0 ? absent : report.variables.join(", ")],
    ]),
  );
