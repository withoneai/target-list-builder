import { mkdirSync, writeFileSync } from "node:fs";
import type { GatedQualification, KnownAccount } from "./types.js";

/**
 * The local artifact. It exists so a run is reviewable without opening a
 * spreadsheet, and so the demo path produces something you can actually read.
 * Skips are kept in the report and in the sheet on purpose: the rows the
 * qualifier threw away are the fastest way to tell whether config/targets.md
 * says what you meant it to say.
 */

export interface ReportInput {
  gated: GatedQualification;
  known: KnownAccount[];
  runDate: string;
  origin: string;
  sourceRows: number;
  droppedRows: number;
  droppedNoDomain: number;
}

/** "1 row" / "3 rows", because a report with bad grammar reads as a bug. */
export function rowCount(n: number): string {
  return n === 1 ? "1 row" : `${n} rows`;
}

export function counts(gated: GatedQualification): Record<"target" | "maybe" | "skip", number> {
  const tally = { target: 0, maybe: 0, skip: 0 };
  for (const row of gated.rows) tally[row.verdict.tier]++;
  return tally;
}

export function render(input: ReportInput): string {
  const { gated, known, runDate, origin, sourceRows } = input;
  const tally = counts(gated);
  const lines: string[] = [];

  lines.push(`# Target list, ${runDate}`);
  lines.push("");
  lines.push(
    `${sourceRows} source rows from ${origin}. ` +
      `Dropped ${rowCount(input.droppedRows)} that was not a company and ` +
      `${rowCount(input.droppedNoDomain)} with no usable domain. ` +
      `${known.length} already in the CRM. ` +
      `${tally.target} target, ${tally.maybe} maybe, ${tally.skip} skip.`,
  );

  for (const tier of ["target", "maybe", "skip"] as const) {
    const rows = gated.rows.filter((r) => r.verdict.tier === tier);
    if (!rows.length) continue;
    lines.push("", `## ${tier} (${rows.length})`);
    for (const { candidate, verdict } of rows) {
      lines.push("");
      lines.push(`### ${candidate.company} — ${candidate.domain}`);
      lines.push("");
      lines.push(`- ${verdict.what_they_do}`);
      lines.push(
        `- ${candidate.postings} open role${candidate.postings === 1 ? "" : "s"}: ${candidate.roles.join(", ")}`,
      );
      lines.push(`- ${verdict.why}`);
      if (verdict.hook) lines.push(`- Opening line: ${verdict.hook}`);
      if (candidate.sourceUrls[0]) lines.push(`- Source: ${candidate.sourceUrls[0]}`);
    }
  }

  if (known.length) {
    lines.push("", `## Already in the CRM (${known.length})`);
    lines.push("");
    lines.push("Removed before qualification. These are somebody's accounts already.");
    lines.push("");
    for (const account of known) {
      lines.push(
        `- ${account.candidate.company} (${account.candidate.domain}) — HubSpot ${account.hubspotId}, ` +
          `filed as "${account.hubspotName}"`,
      );
    }
  }

  if (gated.invented.length) {
    lines.push("", "## Dropped: the model cited a company the source never produced");
    lines.push("");
    for (const domain of gated.invented) lines.push(`- ${domain}`);
  }

  if (gated.unqualified.length) {
    lines.push("", "## Unqualified: the model returned no verdict");
    lines.push("");
    for (const candidate of gated.unqualified) {
      lines.push(`- ${candidate.company} (${candidate.domain})`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function write(markdown: string, runDate: string): string {
  const dir = new URL("../reports/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  const path = new URL(`targets-${runDate}.md`, dir);
  writeFileSync(path, markdown, "utf8");
  return `reports/targets-${runDate}.md`;
}
