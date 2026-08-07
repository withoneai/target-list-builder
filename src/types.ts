/** A row exactly as the scrape produced it. Shape is the source's business. */
export type SourceRow = Record<string, unknown>;

/** What the extraction pass pulls out of one messy row. */
export interface Extracted {
  row: number;
  is_company: boolean;
  company: string;
  domain: string;
  role: string;
  location: string;
  evidence: string;
  source_url: string;
}

/** One company after in-batch rows are folded together. Deterministic. */
export interface Candidate {
  domain: string;
  company: string;
  roles: string[];
  locations: string[];
  evidence: string[];
  sourceUrls: string[];
  /** How many source rows named this company. Several open roles is a signal. */
  postings: number;
}

/** A candidate that HubSpot already knows about. Never qualified, never sold. */
export interface KnownAccount {
  candidate: Candidate;
  hubspotId: string;
  hubspotName: string;
}

/** The model's verdict on one new company. */
export interface Verdict {
  domain: string;
  tier: "target" | "maybe" | "skip";
  what_they_do: string;
  why: string;
  hook: string;
}

export interface Qualification {
  verdicts: Verdict[];
}

/** A verdict paired back to its candidate, after the gate. */
export interface Row {
  candidate: Candidate;
  verdict: Verdict;
}

export interface GatedQualification {
  rows: Row[];
  /** Verdicts naming a domain the scrape never produced. */
  invented: string[];
  /** Candidates the model returned nothing for. */
  unqualified: Candidate[];
}

export interface TargetsConfig {
  sellTo: string;
  signals: string;
  skip: string;
}
