import {
  DEMO,
  createCompanies,
  limits,
  loadTargetsConfig,
  sheetConfigured,
  sheetTab,
} from "./config.js";
import { probeHubSpot } from "./crm.js";
import { probeSheets } from "./sheet.js";
import { probeApify } from "./source.js";

/**
 * Proves the run will work before the Monday it matters: the target definition
 * parses, and (live only) every connection answers a cheap read. The Apify
 * probe deliberately does not start the task, because a check should never
 * spend scrape credits.
 */
let failed = false;

try {
  const config = loadTargetsConfig();
  const skipRules = config.skip.split("\n").filter((l) => l.trim().startsWith("- ")).length;
  console.log(
    `✓ config/targets.md parses (${config.sellTo.length} chars of ICP, ${skipRules} skip rules)`,
  );
  console.log(`✓ limits: ${limits.maxSourceRows} source rows, ${limits.extractBatch} rows per extraction call`);

  if (DEMO) {
    console.log("\nNo keys in the environment, so no connection was probed.");
    console.log("This clone will run `npm start` in demo mode: recorded scrape, real pipeline.");
  } else {
    console.log(`✓ Apify: ${await probeApify()}`);
    const companies = await probeHubSpot();
    console.log(`✓ HubSpot answers: ${companies} companies on the first page`);
    if (sheetConfigured()) {
      console.log(`✓ Google Sheets: "${await probeSheets()}", writing the ${sheetTab()} tab`);
    } else {
      console.log("· TARGET_SHEET_ID not set, the report is the only output (optional)");
    }
    console.log(
      createCompanies()
        ? "✓ HubSpot company creation ON: targets will be created in your CRM"
        : "· HubSpot company creation off, this run is read-only against the CRM (optional)",
    );
  }
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  failed = true;
}

process.exit(failed ? 1 : 0);
