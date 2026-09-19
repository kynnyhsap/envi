// The text form of each report. `--json` prints the encoded report instead.
import {
  type CacheClearReport,
  type CacheListReport,
  type CheckReport,
  type InspectReport,
  type SyncReport,
  ValueOrigin,
  type VarFailure,
} from "@envi/core";

/** The text that stands for a redacted value, and for an absent cell. */
const redacted = "<redacted>";

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

const failureLine = (failure: VarFailure): string =>
  failure.reference === null
    ? `  ✗ ${failure.key}: ${failure.error} ${failure.reason}`
    : `  ✗ ${failure.key} (${failure.reference}): ${failure.error} ${failure.reason}`;

const lines = (parts: ReadonlyArray<string>): string => `${parts.join("\n")}\n`;

/** The text of `envi sync`. */
export const sync = (report: SyncReport): string =>
  lines([
    `Synced the stage ${report.stage} from ${report.configs} ${report.configs === 1 ? "config" : "configs"} in ${report.durationMillis} ms.`,
    ...report.providers.map(
      (entry) =>
        `  ${entry.provider}: ${entry.secrets} secrets, ${entry.cached} cached, ${entry.resolved} resolved`,
    ),
    ...(report.failures.length === 0
      ? []
      : [
          `${report.failures.length} ${report.failures.length === 1 ? "var" : "vars"} failed:`,
          ...report.failures.map(failureLine),
        ]),
  ]);

/** The text of `envi check`. */
export const check = (report: CheckReport): string =>
  lines([
    `Stage: ${report.stage}`,
    ...report.passed.map((key) => `  ✓ ${key}`),
    ...report.failures.map(failureLine),
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
        entry.origin !== ValueOrigin.Unset && entry.redacted ? redacted : (entry.value ?? absent),
      ]),
    ]),
  ]);

/** The text of `envi cache list`. */
export const cacheList = (report: CacheListReport): string =>
  report.entries.length === 0
    ? lines(["The cache holds no entry."])
    : lines([
        `Directory: ${report.directory ?? absent}`,
        ...table([
          ["PROVIDER", "REFERENCE", "RESOLVED", "EXPIRES"],
          ...report.entries.map((entry) => [
            entry.provider,
            entry.reference,
            entry.resolvedAt,
            entry.expiresAt,
          ]),
        ]),
      ]);

/** The text of `envi cache clear`. */
export const cacheClear = (report: CacheClearReport): string =>
  lines([`Removed ${report.removed} cache ${report.removed === 1 ? "entry" : "entries"}.`]);
