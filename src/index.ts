import { fold } from "./candidates.js";
import {
  DEMO,
  DEMO_REASON,
  createCompanies,
  limits,
  loadTargetsConfig,
  sheetConfigured,
  sheetTab,
} from "./config.js";
import { createTargets, splitAgainstCrm } from "./crm.js";
import { extract } from "./extract.js";
import { qualify } from "./qualify.js";
import { counts, render, rowCount, write } from "./report.js";
import { appendTargets } from "./sheet.js";
import { readSource } from "./source.js";

if (process.argv.includes("--help")) {
  console.log(
    [
      "Usage:",
      "  npm start              read the source, qualify it, write the list",
      "  npm start -- --demo    replay the recorded scrape, no keys, no network",
      "",
      "Set CREATE_HUBSPOT_COMPANIES=true to also create the targets in HubSpot.",
      "Without it, nothing in this repo writes to your CRM.",
    ].join("\n"),
  );
  process.exit(0);
}

const config = loadTargetsConfig();
const demoNote = DEMO ? ` (demo: ${DEMO_REASON}, replaying the recorded scrape)` : "";
console.log(`── target list${demoNote}\n`);
if (DEMO && DEMO_REASON !== "--demo") {
  console.log("   No keys found, so this replays a recorded scrape of a fictional job board:");
  console.log("   invented companies, real pipeline. Copy .env.example to .env to read yours.\n");
}

try {
  const source = await readSource();
  console.log(`   read ${source.rows.length} rows from ${source.origin}`);
  if (!source.rows.length) {
    console.log("\n   The source returned nothing. No list to build.");
    process.exit(0);
  }
  if (source.rows.length >= limits.maxSourceRows) {
    console.log(`   ! capped at MAX_SOURCE_ROWS=${limits.maxSourceRows}, there may be more`);
  }

  const extractions = await extract(source.rows);
  const { candidates, droppedRows, droppedNoDomain } = fold(extractions);
  console.log(
    `   ${candidates.length} companies` +
      ` (dropped ${rowCount(droppedRows)} that was not a company,` +
      ` ${rowCount(droppedNoDomain)} with no usable domain)`,
  );
  const multi = candidates.filter((c) => c.postings > 1);
  for (const candidate of multi) {
    console.log(`     - ${candidate.company}: ${candidate.postings} open roles`);
  }

  const { fresh, known } = await splitAgainstCrm(candidates);
  console.log(`   ${known.length} already in the CRM, ${fresh.length} new`);
  for (const account of known) {
    console.log(`     - dropped, already yours: ${account.candidate.company} (${account.hubspotId})`);
  }
  if (!fresh.length) {
    console.log("\n   Nothing new in this source. No list to write.");
    process.exit(0);
  }

  const gated = await qualify(config, fresh);
  const tally = counts(gated);
  console.log(`\n   qualified: ${tally.target} target, ${tally.maybe} maybe, ${tally.skip} skip`);
  for (const { candidate, verdict } of gated.rows.filter((r) => r.verdict.tier === "target")) {
    console.log(`     - ${candidate.company} (${candidate.domain}): ${verdict.why}`);
  }
  for (const domain of gated.invented) {
    console.log(`   ! dropped, cited a company the source never produced: ${domain}`);
  }
  for (const candidate of gated.unqualified) {
    console.log(`   ! unqualified, the model skipped it: ${candidate.company}`);
  }

  const runDate = new Date().toISOString().slice(0, 10);
  const reportPath = write(
    render({
      gated,
      known,
      runDate,
      origin: source.origin,
      sourceRows: source.rows.length,
      droppedRows,
      droppedNoDomain,
    }),
    runDate,
  );
  console.log(`   wrote ${reportPath}`);

  if (!DEMO && sheetConfigured()) {
    const written = await appendTargets(gated, runDate);
    console.log(`   appended ${written} rows to the ${sheetTab()} tab`);
  }

  if (!DEMO && createCompanies()) {
    const created = await createTargets(gated.rows);
    for (const company of created) {
      console.log(`   created in HubSpot: ${company.domain} (${company.hubspotId})`);
    }
  }

  if (DEMO) {
    console.log("\n   demo mode: nothing was scraped, no CRM was read, no sheet was written.");
  } else {
    if (!sheetConfigured()) {
      console.log("\n   TARGET_SHEET_ID is not set, so the report is the only output (optional).");
    }
    if (!createCompanies()) {
      console.log("   CREATE_HUBSPOT_COMPANIES is off, so nothing was written to the CRM.");
    }
  }
} catch (err) {
  console.error(`   failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
