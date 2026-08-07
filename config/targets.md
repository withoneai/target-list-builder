# Who we are building a list of

This file is the whole configuration of the qualifier. Claude reads the three
sections below verbatim, once per run, and applies them to every company the
scrape turned up. There is no scoring matrix and no keyword list to maintain.
Rewrite it in your own words and the next run behaves differently.

The example below describes a fictional company so the demo run makes sense:
we sell an observability platform to engineering teams that run their own
infrastructure. Replace all three sections with yours.

## Who we sell to

Engineering organisations big enough to have a platform team but not big
enough to have built their own internal observability stack. In practice that
is roughly 50 to 500 engineers, Series B through pre-IPO, running their own
Kubernetes rather than sitting entirely on a managed platform-as-a-service.

We do best where infrastructure is a cost centre somebody is being asked to
explain: logistics, fintech, healthcare, marketplaces, anyone whose cloud bill
grew faster than their revenue.

We have never won a deal at a company under about 30 engineers. They have no
platform team, so there is nobody to sell to.

## What counts as a signal

The reason to build the list off a job board is that hiring is the one thing a
company cannot fake. Weight the evidence like this:

- An open platform, SRE, infrastructure or DevOps role is the signal. Somebody
  has budget and a gap, right now.
- Several such roles open at once is a much stronger signal than one. A team
  hiring three SREs has a problem it has already admitted to.
- The posting text matters more than the title. "Own our migration off
  self-hosted Prometheus", "reduce our observability spend", "on-call is
  painful" are the sentences worth quoting back. A generic list of buzzwords
  is not evidence of anything.
- A single generalist full-stack role at a company with no other infra hiring
  is not a signal. That is a company with no platform team.

## What to skip, and say so plainly

- Staffing agencies, recruiters, dev shops and consultancies. They are hiring
  for somebody else, so the signal belongs to a client we cannot see.
- Companies whose whole product is observability, monitoring or logging. They
  are competitors, not buyers.
- Anything where the evidence does not actually say what the company does. Say
  you do not know rather than guessing from the name. A row you refuse to
  qualify is more useful than a confident invention, because the human reading
  the sheet can check it in ten seconds.
