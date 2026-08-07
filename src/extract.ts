import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CLAUDE_MODEL, DEMO, limits, loadFixture } from "./config.js";
import type { Extracted, SourceRow } from "./types.js";

/**
 * The first model pass, and the reason this repo is not a field mapper.
 *
 * A scrape returns whatever the page had. One board calls it `companyName`,
 * the next puts the company in the title, the third only mentions it halfway
 * down the description. Writing a parser per source is the work that stops
 * anybody from building a list off a live source in the first place, and it
 * breaks the week the page changes. So the model reads the raw row and pulls
 * out the four things that matter, including the one sentence of evidence the
 * qualifier will later have to justify itself with.
 *
 * It also throws rows away: sponsored slots, board furniture, aggregator
 * pages. `is_company: false` is a real answer here.
 */

const ExtractedSchema = z.object({
  extractions: z.array(
    z.object({
      row: z.number().int().nonnegative(),
      is_company: z.boolean(),
      company: z.string(),
      domain: z.string(),
      role: z.string(),
      location: z.string(),
      evidence: z.string(),
      source_url: z.string(),
    }),
  ),
});

const TOOL = {
  name: "extract_companies",
  description: "Pull the hiring company out of each scraped row, or say it is not one.",
  input_schema: {
    type: "object" as const,
    properties: {
      extractions: {
        type: "array",
        description: "Exactly one entry per row you were given, in any order.",
        items: {
          type: "object",
          properties: {
            row: { type: "number", description: "The `row` number from the input. Never invent one." },
            is_company: {
              type: "boolean",
              description:
                "False when the row is not a real company hiring: a sponsored slot, an ad, board furniture, or a posting whose employer is genuinely not stated. Everything else on the entry is ignored when this is false.",
            },
            company: {
              type: "string",
              description:
                "The hiring company's name, cleaned: no legal suffix, no accelerator batch tag, no location, no ATS boilerplate.",
            },
            domain: {
              type: "string",
              description:
                "The company's own website host, lowercase, no scheme and no www (example: northwindlogistics.com). Never the job board's domain and never an ATS domain such as greenhouse.io or lever.co. Empty string if the row genuinely does not contain it.",
            },
            role: { type: "string", description: "The role title as posted, trimmed." },
            location: { type: "string", description: "Location as posted, or an empty string." },
            evidence: {
              type: "string",
              description:
                "One sentence QUOTED OR CLOSELY PARAPHRASED FROM THE ROW that says what this team is dealing with. Prefer a sentence about their infrastructure, their scale or their pain. Never a sentence you wrote about the company in general. Empty string if the row says nothing useful.",
            },
            source_url: {
              type: "string",
              description: "The URL of this posting from the row, so a human can check the claim.",
            },
          },
          required: ["row", "is_company", "company", "domain", "role", "location", "evidence", "source_url"],
        },
      },
    },
    required: ["extractions"],
  },
};

async function fromClaude(batch: { row: number; data: SourceRow }[]): Promise<unknown> {
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
          "Below are raw rows from a scrape of a hiring source. They come from a",
          "web scraper, so the field names are the page's and not a schema: the",
          "company may be in a dedicated field, in the title, or only in the body",
          "text. Read each row and pull out the hiring company.",
          "",
          "Rules that matter more than they look:",
          "- The domain must be the COMPANY's own site. A scrape is full of board",
          "  URLs and applicant-tracking URLs; those are not the company.",
          "- Do not guess a domain from the company name. An empty domain is a",
          "  correct answer and the pipeline handles it. An invented one sends a",
          "  salesperson to the wrong company.",
          "- The evidence sentence must come from the row. If the row is a wall of",
          "  generic benefits copy, return an empty evidence string rather than",
          "  writing a sentence that sounds like evidence.",
          "",
          "The rows:",
          JSON.stringify(batch, null, 2),
          "",
          "Return exactly one entry per row number above.",
        ].join("\n"),
      },
    ],
  });

  const block = res.content.find((c) => c.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("Claude returned no extractions.");
  return block.input;
}

/**
 * In demo mode the recorded tool call is read from fixtures/extracted.json. It
 * goes through the same schema validation and the same row-number check as a
 * live response: the recording replaces the wire, never the code.
 */
export async function extract(rows: SourceRow[]): Promise<Extracted[]> {
  const numbered = rows.map((data, row) => ({ row, data }));

  let raw: unknown[];
  if (DEMO) {
    raw = [loadFixture("extracted.json")];
  } else {
    const batches: { row: number; data: SourceRow }[][] = [];
    for (let i = 0; i < numbered.length; i += limits.extractBatch) {
      batches.push(numbered.slice(i, i + limits.extractBatch));
    }
    raw = await Promise.all(batches.map(fromClaude));
  }

  const known = new Set(numbered.map((n) => n.row));
  const seen = new Set<number>();
  const out: Extracted[] = [];
  for (const chunk of raw) {
    for (const extraction of ExtractedSchema.parse(chunk).extractions) {
      // A row number the scrape never produced is the model inventing a row.
      if (!known.has(extraction.row) || seen.has(extraction.row)) continue;
      seen.add(extraction.row);
      out.push(extraction);
    }
  }
  return out;
}
