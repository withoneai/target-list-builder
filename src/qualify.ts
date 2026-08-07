import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CLAUDE_MODEL, DEMO, loadFixture } from "./config.js";
import type { Candidate, GatedQualification, Qualification, TargetsConfig } from "./types.js";

/**
 * The second model pass, and the one that decides what the list is worth.
 *
 * Everything it knows about who to sell to comes from config/targets.md, read
 * verbatim. There is no keyword list and no scoring matrix in this repo, which
 * is the point: a sales lead can retune the whole qualifier by editing three
 * paragraphs of English, and never has to open a file with code in it.
 */

const QualificationSchema = z.object({
  verdicts: z.array(
    z.object({
      domain: z.string(),
      tier: z.enum(["target", "maybe", "skip"]),
      what_they_do: z.string(),
      why: z.string().min(10),
      hook: z.string(),
    }),
  ),
});

const TOOL = {
  name: "qualify_companies",
  description: "Tier every company against the target definition and say why.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdicts: {
        type: "array",
        description: "One entry per company domain given. None may be skipped.",
        items: {
          type: "object",
          properties: {
            domain: {
              type: "string",
              description: "A domain from the companies list. Never one you construct.",
            },
            tier: {
              type: "string",
              enum: ["target", "maybe", "skip"],
              description:
                "target: the evidence matches who we sell to and a rep should work it this quarter. maybe: plausible, but something the evidence does not settle. skip: the target definition rules it out, including when the evidence is too thin to tell.",
            },
            what_they_do: {
              type: "string",
              description:
                "One short sentence on what the company does, drawn only from the evidence. If the evidence does not say, write exactly: Not stated in the source.",
            },
            why: {
              type: "string",
              description:
                "Two sentences at most, addressed to the rep who has to work this. Quote the specific evidence: the number of open roles, the sentence from the posting. For a skip, name which rule in the target definition ruled it out.",
            },
            hook: {
              type: "string",
              description:
                "The one line a rep could open with, built from this company's own evidence. Never a template with a blank in it. Empty string for anything not tiered target.",
            },
          },
          required: ["domain", "tier", "what_they_do", "why", "hook"],
        },
      },
    },
    required: ["verdicts"],
  },
};

/** What the model sees. The postings count is measured, never asked for. */
function brief(candidates: Candidate[]) {
  return candidates.map((c) => ({
    domain: c.domain,
    company: c.company,
    open_roles: c.roles,
    open_role_count: c.postings,
    locations: c.locations,
    evidence_from_postings: c.evidence,
  }));
}

async function fromClaude(config: TargetsConfig, candidates: Candidate[]): Promise<unknown> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          "You are building the quarter's target list for a B2B sales team. Every",
          "company below came off a live source this morning and has already been",
          "checked against the CRM, so none of them are accounts the team knows.",
          "Your job is to say which ones are worth a rep's week.",
          "",
          "Who we sell to:",
          config.sellTo,
          "",
          "What counts as a signal:",
          config.signals,
          "",
          "What to skip, and say so plainly:",
          config.skip,
          "",
          "The companies, each with a domain you must cite back exactly:",
          JSON.stringify(brief(candidates), null, 2),
          "",
          "Return one verdict per domain, no more and no fewer. Judge only on the",
          "evidence given. You may not use anything you happen to know about a",
          "company that is not in its evidence, and you may not infer what a",
          "company does from its name: a list that is confidently wrong about ten",
          "companies costs the team more than a list that says 'not stated' about",
          "ten. Where the evidence is too thin to place a company, skip it and say",
          "that is why. A list where everything is a target is not a list.",
        ].join("\n"),
      },
    ],
  });

  const block = res.content.find((c) => c.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("Claude returned no verdicts.");
  return block.input;
}

/**
 * The gate, in code, after the model. Two mechanical failure modes. A verdict
 * citing a domain the scrape never produced is the model inventing a company,
 * so it is dropped and named rather than quietly reaching the sheet. A company
 * the model returned nothing for would otherwise vanish, so it is surfaced.
 */
export function gate(
  qualification: Qualification,
  candidates: Candidate[],
): GatedQualification {
  const known = new Map(candidates.map((c) => [c.domain, c]));
  const seen = new Set<string>();
  const invented: string[] = [];

  const rows = qualification.verdicts.flatMap((verdict) => {
    const candidate = known.get(verdict.domain);
    if (!candidate || seen.has(verdict.domain)) {
      if (!candidate) invented.push(verdict.domain);
      return [];
    }
    seen.add(verdict.domain);
    return [{ candidate, verdict }];
  });

  const order = { target: 0, maybe: 1, skip: 2 };
  rows.sort(
    (a, b) =>
      order[a.verdict.tier] - order[b.verdict.tier] ||
      b.candidate.postings - a.candidate.postings ||
      a.candidate.company.localeCompare(b.candidate.company),
  );

  return {
    rows,
    invented,
    unqualified: candidates.filter((c) => !seen.has(c.domain)),
  };
}

/**
 * In demo mode the recorded tool call is read from fixtures/qualified.json. It
 * still goes through the same schema validation and the same gate as a live
 * Claude response: the recording replaces the wire, never the code.
 */
export async function qualify(
  config: TargetsConfig,
  candidates: Candidate[],
): Promise<GatedQualification> {
  const raw = DEMO ? loadFixture("qualified.json") : await fromClaude(config, candidates);
  const qualification = QualificationSchema.parse(raw) satisfies Qualification;
  return gate(qualification, candidates);
}
