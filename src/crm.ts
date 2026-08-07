import {
  createBatchCrmObjectsCompaniesObjectType,
  searchCrmObjectsCompaniesObjectType,
} from "@withone/sdk/hubspot";
import { DEMO, connections, loadFixture, oneClient } from "./config.js";
import { normalizeDomain } from "./candidates.js";
import type { Candidate, KnownAccount, Row } from "./types.js";

/**
 * The dedupe. This is the step that separates a target list from a scrape:
 * half of any live source is companies your team already owns, already sold,
 * or already lost. Sending those to a rep as new is how a list loses its
 * credibility on the first read.
 *
 * The search is read-only. The one write in this file only runs when you set
 * CREATE_HUBSPOT_COMPANIES=true.
 */

function crm() {
  return oneClient().connection(connections.hubspot());
}

function results<T>(data: unknown): T[] {
  const list = (data as { results?: unknown })?.results;
  return Array.isArray(list) ? (list as T[]) : [];
}

interface HubSpotCompany {
  id: string;
  properties?: { name?: string; domain?: string; website?: string };
}

/** HubSpot's search caps `IN` values; 100 domains a call is comfortably under. */
const DOMAIN_BATCH = 100;

async function searchByDomains(domains: string[]): Promise<HubSpotCompany[]> {
  const found: HubSpotCompany[] = [];
  for (let i = 0; i < domains.length; i += DOMAIN_BATCH) {
    const slice = domains.slice(i, i + DOMAIN_BATCH);
    const res = await crm().run(
      searchCrmObjectsCompaniesObjectType({
        path: { objectType: "companies" },
        body: {
          after: "0",
          limit: 200,
          properties: ["name", "domain", "website"],
          sorts: [],
          filterGroups: [
            { filters: [{ propertyName: "domain", operator: "IN", values: slice }] },
          ],
        },
      }),
    );
    found.push(...results<HubSpotCompany>(res.data));
  }
  return found;
}

export interface Split {
  fresh: Candidate[];
  known: KnownAccount[];
}

/**
 * Candidates split into the ones HubSpot has never heard of and the ones it
 * has. Matching is on the normalised domain in both directions, because a CRM
 * fills `domain` on some records and only `website` on others, and a record
 * saved as "https://www.northwind.com/" is the same company as northwind.com.
 */
export async function splitAgainstCrm(candidates: Candidate[]): Promise<Split> {
  if (!candidates.length) return { fresh: [], known: [] };

  const domains = candidates.map((c) => c.domain);
  const companies = DEMO
    ? (loadFixture("crm.json") as HubSpotCompany[])
    : await searchByDomains(domains);

  const byDomain = new Map<string, HubSpotCompany>();
  for (const company of companies) {
    for (const raw of [company.properties?.domain, company.properties?.website]) {
      const domain = normalizeDomain(raw ?? "");
      if (domain && !byDomain.has(domain)) byDomain.set(domain, company);
    }
  }

  const fresh: Candidate[] = [];
  const known: KnownAccount[] = [];
  for (const candidate of candidates) {
    const match = byDomain.get(candidate.domain);
    if (match) {
      known.push({
        candidate,
        hubspotId: match.id,
        hubspotName: match.properties?.name || candidate.company,
      });
    } else {
      fresh.push(candidate);
    }
  }
  return { fresh, known };
}

export interface Created {
  domain: string;
  hubspotId: string;
}

/**
 * The opt-in write. Only tier `target` is created, and the record carries the
 * source URL and the model's reason, so the next person to open it can see
 * where the company came from and disagree with it.
 */
export async function createTargets(rows: Row[]): Promise<Created[]> {
  const targets = rows.filter((r) => r.verdict.tier === "target");
  if (!targets.length) return [];

  const res = await crm().run(
    createBatchCrmObjectsCompaniesObjectType({
      path: { objectType: "companies" },
      body: {
        inputs: targets.map(({ candidate, verdict }) => ({
          associations: [],
          properties: {
            name: candidate.company,
            domain: candidate.domain,
            description: `${verdict.what_they_do} Added by target-list-builder: ${verdict.why}`.slice(0, 900),
            hs_lead_status: "NEW",
            website: `https://${candidate.domain}`,
          },
        })),
      },
    }),
  );

  return results<{ id: string; properties?: { domain?: string } }>(res.data).map((company) => ({
    domain: company.properties?.domain ?? "",
    hubspotId: company.id,
  }));
}

/** A cheap liveness probe for `npm run check`: one bounded company search. */
export async function probeHubSpot(): Promise<number> {
  const res = await crm().run(
    searchCrmObjectsCompaniesObjectType({
      path: { objectType: "companies" },
      body: {
        after: "0",
        limit: 5,
        properties: ["name", "domain"],
        sorts: [],
        filterGroups: [{ filters: [{ propertyName: "domain", operator: "HAS_PROPERTY" }] }],
      },
    }),
  );
  return results<HubSpotCompany>(res.data).length;
}
