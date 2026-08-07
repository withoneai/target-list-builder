import type { Candidate, Extracted } from "./types.js";

/**
 * The deterministic half. Everything here is arithmetic and string handling,
 * and it is deliberately not the model's job: how many postings a company has
 * is a count, and a count should never come back from a language model.
 */

/** Board and applicant-tracking hosts that are never the hiring company. */
const NOT_A_COMPANY = new Set([
  "greenhouse.io",
  "boards.greenhouse.io",
  "lever.co",
  "jobs.lever.co",
  "ashbyhq.com",
  "workable.com",
  "bamboohr.com",
  "myworkdayjobs.com",
  "smartrecruiters.com",
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "ycombinator.com",
  "wellfound.com",
  "angel.co",
]);

export function normalizeDomain(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (!value) return "";
  value = value.replace(/^https?:\/\//, "");
  value = value.split("/")[0] ?? "";
  value = value.split("?")[0] ?? "";
  value = value.replace(/^www\./, "");
  value = value.replace(/\.$/, "");
  // A bare label with no dot is not a host, whatever the model called it.
  if (!value.includes(".") || value.includes(" ")) return "";
  if (NOT_A_COMPANY.has(value)) return "";
  return value;
}

function push(list: string[], value: string): void {
  const trimmed = value.trim();
  if (trimmed && !list.includes(trimmed)) list.push(trimmed);
}

export interface Folded {
  candidates: Candidate[];
  /** Rows the model called furniture, or that carried no usable domain. */
  droppedRows: number;
  droppedNoDomain: number;
}

/**
 * Rows to companies. One company hiring three SREs arrives as three rows and
 * leaves as one candidate with `postings: 3`, which config/targets.md names as
 * the strongest signal on the board. Folding on the domain rather than the
 * name is what makes that count trustworthy: "Northwind Logistics, Inc." and
 * "Northwind" are one company only if they share a host.
 */
export function fold(extractions: Extracted[]): Folded {
  const byDomain = new Map<string, Candidate>();
  let droppedRows = 0;
  let droppedNoDomain = 0;

  for (const item of extractions) {
    if (!item.is_company) {
      droppedRows++;
      continue;
    }
    const domain = normalizeDomain(item.domain);
    if (!domain || !item.company.trim()) {
      droppedNoDomain++;
      continue;
    }

    const existing = byDomain.get(domain);
    const candidate: Candidate =
      existing ??
      {
        domain,
        company: item.company.trim(),
        roles: [],
        locations: [],
        evidence: [],
        sourceUrls: [],
        postings: 0,
      };

    candidate.postings++;
    push(candidate.roles, item.role);
    push(candidate.locations, item.location);
    push(candidate.evidence, item.evidence);
    push(candidate.sourceUrls, item.source_url);
    byDomain.set(domain, candidate);
  }

  // Most postings first: the strongest signal should be the first thing a
  // human reads, before any model has had an opinion about it.
  const candidates = [...byDomain.values()].sort(
    (a, b) => b.postings - a.postings || a.company.localeCompare(b.company),
  );
  return { candidates, droppedRows, droppedNoDomain };
}
