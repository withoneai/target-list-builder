import "dotenv/config";
import { readFileSync } from "node:fs";
import { One } from "@withone/sdk";
import type { TargetsConfig } from "./types.js";

/**
 * Demo mode replays a recorded scrape of a fictional job board from fixtures/.
 * It turns on two ways: explicitly with --demo, or implicitly when the keys are
 * absent. The implicit fallback is what makes a fresh clone runnable with zero
 * configuration: the same pipeline runs, only the Apify read, the HubSpot read
 * and the two Claude calls come off disk instead of the wire.
 */
const KEYS_PRESENT = Boolean(
  process.env.ONE_SECRET &&
    process.env.ANTHROPIC_API_KEY &&
    process.env.ONE_CONNECTION_APIFY &&
    process.env.ONE_CONNECTION_HUBSPOT,
);

export const DEMO = process.argv.includes("--demo") || !KEYS_PRESENT;
export const DEMO_REASON = process.argv.includes("--demo")
  ? "--demo"
  : KEYS_PRESENT
    ? ""
    : "no keys in the environment";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    console.error("Or run `npm start -- --demo` to replay the recorded scrape, no keys needed.");
    process.exit(1);
  }
  return value;
}

let client: One | undefined;
export function oneClient(): One {
  client ??= new One(required("ONE_SECRET"));
  return client;
}

export const connections = {
  apify: () => required("ONE_CONNECTION_APIFY"),
  hubspot: () => required("ONE_CONNECTION_HUBSPOT"),
  sheets: () => required("ONE_CONNECTION_SHEETS"),
};

/**
 * The source, and the one decision this repo asks you to make. A saved Apify
 * task runs the scrape fresh and spends credits. A dataset id replays a run
 * you already paid for, which is what you want while you are still editing
 * config/targets.md and re-running the qualifier.
 */
export const source = {
  taskId: () => process.env.APIFY_TASK_ID?.trim() || "",
  datasetId: () => process.env.APIFY_DATASET_ID?.trim() || "",
};

/** Sheets is an optional output: no sheet id means the report is the output. */
export const sheetConfigured = () => Boolean(process.env.TARGET_SHEET_ID);
export const sheetId = () => required("TARGET_SHEET_ID");
export const sheetTab = () => process.env.TARGET_SHEET_TAB?.trim() || "Targets";

/** CRM writes are opt-in, because they land in a CRM other people work in. */
export const createCompanies = () => process.env.CREATE_HUBSPOT_COMPANIES === "true";

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`${name} must be a positive number, not "${raw}".`);
    process.exit(1);
  }
  return value;
}

export const limits = {
  /** Source rows read per run. The scrape can be far larger than you want. */
  maxSourceRows: numberEnv("MAX_SOURCE_ROWS", 200),
  /** Rows per extraction call. Keeps one bad row from poisoning the batch. */
  extractBatch: numberEnv("EXTRACT_BATCH", 25),
};

export function loadFixture(relPath: string): unknown {
  const url = new URL(`../fixtures/${relPath}`, import.meta.url);
  try {
    return JSON.parse(readFileSync(url, "utf8"));
  } catch {
    throw new Error(`No fixture at fixtures/${relPath}.`);
  }
}

/**
 * config/targets.md, parsed deterministically: three required ## sections. The
 * model reads the text verbatim; nothing else interprets it. There is no
 * keyword list and no scoring matrix anywhere in this repo, on purpose.
 */
export function loadTargetsConfig(): TargetsConfig {
  const raw = readFileSync(new URL("../config/targets.md", import.meta.url), "utf8");
  const section = (heading: string): string => {
    const match = raw.match(new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m"));
    if (!match?.[1]) {
      throw new Error(`config/targets.md is missing the "## ${heading}" section.`);
    }
    return match[1].trim();
  };
  return {
    sellTo: section("Who we sell to"),
    signals: section("What counts as a signal"),
    skip: section("What to skip, and say so plainly"),
  };
}
