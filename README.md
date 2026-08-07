# target-list-builder

Build the quarter's target list off a live source instead of buying a stale one.

Apify scrapes the source. Claude reads the messy rows, pulls out the hiring
company, and qualifies each one against an ICP you wrote in plain English.
HubSpot removes everyone your team already owns. What lands in Google Sheets is
the companies nobody has worked yet, each with the evidence it was picked on.

Built on [One](https://www.withone.ai), so Apify, HubSpot and Google Sheets are
one auth and one client. Read-only against your CRM unless you opt in.

## Run it in five minutes

```bash
git clone https://github.com/withoneai/target-list-builder
cd target-list-builder
npm install
npm start
```

That works with no keys and no `.env`. It replays a recorded scrape of a
fictional job board through the real pipeline and writes
`reports/targets-<date>.md`:

```
── target list (demo: no keys in the environment, replaying the recorded scrape)

   read 15 rows from fixtures/source.json (recorded scrape)
   9 companies (dropped 1 row that was not a company, 1 row with no usable domain)
     - Northwind Logistics: 3 open roles
     - Halcyon Health: 2 open roles
     - Kestrel Talent Partners: 2 open roles
   2 already in the CRM, 7 new
     - dropped, already yours: Orinoco Payments (14802331907)
     - dropped, already yours: Sable Freight (14802409663)

   qualified: 3 target, 1 maybe, 3 skip
     - Northwind Logistics (northwindlogistics.com): Three open infrastructure
       roles this quarter and they say outright they are standing up a platform
       team from scratch, on their own EKS at about 140 engineers...
   wrote reports/targets-2026-08-07.md
```

## What it does

1. **Reads the source.** A saved [Apify](https://apify.com) task runs your
   scrape (a directory, a job board, a conference attendee page), or an
   `APIFY_DATASET_ID` replays a run you already paid for. Nothing in this repo
   knows what a row looks like, so pointing it at a different source changes no
   code.
2. **Pulls the company out of each row, with Claude.** Scraped rows are messy:
   one board has a `companyName` field, the next buries it in the description,
   the third links to Greenhouse instead of the company. Writing a parser per
   source is the work that stops anyone from doing this, and it breaks the week
   the page changes. The model returns the company, its own domain, the role,
   and one sentence of evidence quoted from the posting. Rows that are adverts
   or board furniture come back marked as such and are dropped.
3. **Folds rows into companies, in code.** Three SRE postings at one company is
   one candidate with `postings: 3`. That count is arithmetic, so it is done in
   code and never asked of a model.
4. **Removes everyone you already know.** Every domain is checked against
   HubSpot in batches, matching on both the `domain` and `website` properties,
   because CRMs fill one or the other. These are somebody's accounts already.
5. **Qualifies what is left, against `config/targets.md`.** Claude reads that
   file verbatim: who you sell to, what counts as a signal, what to skip. Each
   company comes back `target`, `maybe` or `skip`, with the reason and, for
   targets, an opening line built from that company's own evidence.
6. **Writes the list.** A markdown report every run, and an append to a Google
   Sheets tab when `TARGET_SHEET_ID` is set. Skips are kept, not hidden: the
   rows the qualifier threw away are the fastest way to tell whether
   `config/targets.md` says what you meant.

Nothing is emailed and nothing is written to your CRM. Set
`CREATE_HUBSPOT_COMPANIES=true` and the run will also create the `target`
companies in HubSpot with the source URL and the reason on the record. That is
the only write, and it is off by default.

## Configure it

The whole qualifier is `config/targets.md`, three sections of English:

```markdown
## Who we sell to
Engineering organisations big enough to have a platform team but not big
enough to have built their own internal observability stack...

## What counts as a signal
- Several open platform roles at once is a much stronger signal than one...

## What to skip, and say so plainly
- Staffing agencies, recruiters, dev shops and consultancies...
```

There is no keyword list and no scoring matrix anywhere in this repo. Rewrite
those three sections and the next run behaves differently. A sales lead can
retune the list without opening a file with code in it.

## Point it at your own data

```bash
cp .env.example .env
npm run check     # proves the config parses and every connection answers
npm start
```

You need [One](https://www.withone.ai) connected to Apify, HubSpot and Google
Sheets:

```bash
npm i -g @withone/cli
one init
one add apify
one add hubspot
one add google-sheets
one --agent list          # the `key` field for each goes in .env
```

Then set **one** source in `.env`:

- `APIFY_TASK_ID` runs a saved Apify task fresh. Spends Apify credits.
- `APIFY_DATASET_ID` replays a run you already have. Costs nothing, which is
  what you want while you are still editing `config/targets.md`.

`npm run check` never starts the task, because a check should not spend scrape
credits.

## What it costs to run

Per run, against a 200-row scrape:

- **Apify**: whatever your actor costs, once, and zero if you replay a dataset.
- **Claude**: two passes. Extraction is batched at 25 rows a call, so 200 rows
  is 8 calls; qualification is one call over the companies that survived the
  CRM check. On a 200-row source that is a few cents.
- **HubSpot and Google Sheets**: a handful of calls, inside any plan's limits.

`MAX_SOURCE_ROWS` caps the first number. Start small.

## What it does not do

- **It does not email anyone.** There is no send path in this repo at all.
- **It does not enrich.** No headcount, no funding, no contact data. Everything
  a verdict rests on came off the source page, which is what makes the evidence
  column checkable in ten seconds.
- **It does not find people.** It builds a list of companies. Who to contact
  there is the next problem.
- **It does not judge quietly.** Companies the model would not place come back
  as `maybe` or `skip` with the reason, rather than being dropped. A verdict
  citing a company the source never produced is discarded and named in the run
  output.

## Layout

| File | What it is |
|------|-----------|
| `config/targets.md` | The whole qualifier, in English |
| `src/source.ts` | Apify: run the saved task, or replay a dataset |
| `src/extract.ts` | Claude pass one: messy row to company |
| `src/candidates.ts` | Deterministic: normalise domains, fold rows into companies |
| `src/crm.ts` | HubSpot: dedupe against, and the opt-in write |
| `src/qualify.ts` | Claude pass two: tier against `config/targets.md`, then gate |
| `src/sheet.ts` | Google Sheets: append the list |
| `src/report.ts` | The markdown artifact |
| `fixtures/` | The recorded scrape the demo run replays |

MIT.
