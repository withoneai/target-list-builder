import {
  appendValuesSpreadsheetRange,
  applyBatchUpdatesSpreadsheetBatchUpdate,
  getSpreadsheet,
} from "@withone/sdk/googleSheets";
import { connections, oneClient, sheetId, sheetTab } from "./config.js";
import type { GatedQualification } from "./types.js";

/** The sheet a rep actually opens. Evidence columns are not decoration: the */
/** whole list is a set of claims, and every row carries its own receipt. */
export const HEADER = [
  "Run date",
  "Tier",
  "Company",
  "Domain",
  "Open roles",
  "What they do",
  "Why",
  "Opening line",
  "Locations",
  "Source",
];

function sheets() {
  return oneClient().connection(connections.sheets());
}

/** Tab names with a quote or a space need quoting in an A1 range. */
function a1(tab: string): string {
  return /^[A-Za-z0-9_]+$/.test(tab) ? tab : `'${tab.replace(/'/g, "''")}'`;
}

export function rowsFor(gated: GatedQualification, runDate: string): string[][] {
  return gated.rows.map(({ candidate, verdict }) => [
    runDate,
    verdict.tier,
    candidate.company,
    candidate.domain,
    `${candidate.postings}: ${candidate.roles.join("; ")}`,
    verdict.what_they_do,
    verdict.why,
    verdict.hook,
    candidate.locations.join("; "),
    candidate.sourceUrls[0] ?? "",
  ]);
}

/**
 * Append, never overwrite. A target list is built over a quarter out of many
 * runs, and a run that replaced the tab would delete the notes a rep wrote in
 * the columns to the right of it.
 */
export async function appendTargets(gated: GatedQualification, runDate: string): Promise<number> {
  const id = sheetId();
  const tab = sheetTab();
  await ensureTab(id, tab);

  const rows = rowsFor(gated, runDate);
  if (!rows.length) return 0;

  await sheets().run(
    appendValuesSpreadsheetRange({
      path: { spreadsheetId: id, range: `${a1(tab)}!A1` },
      query: { valueInputOption: "RAW" },
      body: { values: rows },
    }),
  );
  return rows.length;
}

/** Creates the tab and writes the header the first time the sheet is used. */
async function ensureTab(spreadsheetId: string, tab: string): Promise<void> {
  const res = await sheets().run(getSpreadsheet({ path: { spreadsheetId }, query: {} }));
  const titles = ((res.data as { sheets?: { properties?: { title?: string } }[] })?.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => Boolean(t));
  if (titles.includes(tab)) return;

  // The SDK's SheetProperties is a stale io_schema that omits `title`, so the
  // tab name goes through mergeBody, the escape hatch for exactly this. The
  // merged value is the complete request, not a fragment, so it is right
  // whether the merge replaces the array or descends into it.
  await sheets().run(
    applyBatchUpdatesSpreadsheetBatchUpdate({
      path: { spreadsheetId },
      body: { requests: [{ addSheet: { properties: {} } }] },
    }).mergeBody({ requests: [{ addSheet: { properties: { title: tab } } }] }),
  );
  await sheets().run(
    appendValuesSpreadsheetRange({
      path: { spreadsheetId, range: `${a1(tab)}!A1` },
      query: { valueInputOption: "RAW" },
      body: { values: [HEADER] },
    }),
  );
}

/** A cheap liveness probe for `npm run check`: read the spreadsheet's tabs. */
export async function probeSheets(): Promise<string> {
  const res = await sheets().run(
    getSpreadsheet({ path: { spreadsheetId: sheetId() }, query: {} }),
  );
  const title = (res.data as { properties?: { title?: string } })?.properties?.title;
  return title ?? "(untitled spreadsheet)";
}
