<p align="center">
  <img src="https://raw.githubusercontent.com/unicodeveloper/openmlr/main/public/brand/openmlr-mark-transparent-96.png" alt="" width="88" height="88">
</p>

# OpenMLR

An open-source, self-hostable **MLR (Medical-Legal-Regulatory) pre-check** for pharma promotional
content. It verifies every claim against real, licensed primary sources, not a private library and shows its
work.

> Decision support for a human reviewer — **not** an autonomous regulatory determination.

## Trust invariants

- **Retrieve, then verify.** The LLM never generates a citation — every citation points at a
  document Valyu actually returned.
- **Abstain, don't bluff.** No evidence → `no_evidence`, never a confident guess.
- **Absence is not contradiction.** Sources arrive as windows of longer documents, so "the label
  doesn't mention this" means the section wasn't retrieved, not that the claim is false. A claim is
  only `contradicted` when the evidence affirmatively says otherwise.
- **Not finding something is not a finding.** Four distinct outcomes, and the reviewer can tell them
  apart: we searched and found nothing · we searched and what we found doesn't address it · the
  search failed · the evidence contradicts the claim. Only the last is a defect in the copy.
- **A failed search is not "no evidence."** Retrieval errors surface separately, and the claim is
  marked un-checked rather than silently cleared.
- **Promotional rules only apply to promotional material.** Fair balance and the boxed-warning guard
  don't run against a labeling excerpt, a bare ISI, or a pasted fragment — there is nothing to
  balance, and firing anyway flags every clean asset.
- **Self-host + bring-your-own-key.** Your asset text and keys stay in your environment.

### Severity

| | Meaning |
|---|---|
| **critical** | The evidence contradicts the claim, or addresses it and fails to bear it out. A defect in the copy. |
| **warning** | Partly supported — the right source, missing an element. |
| **unverified** | We could not check it. Nothing retrieved, or nothing retrieved that speaks to it. **Not** a finding against the copy; attach a reference. |
| **info** | Supported by the cited evidence. |

`unverified` exists because collapsing it into `critical` is what made an ISI transcribed from
approved labeling come back covered in red.

## Features

Paste an asset, hit **Run review**, and every check below runs against it. Findings stream in as the
pipeline works — no spinner, the real audit trail.

### Substantiation

| Feature | What it does | Evidence |
|---|---|---|
| Claim extraction & typing | Pulls every discrete claim out of the asset and types it (efficacy, safety, comparative, dosing, indication, mechanism, biomarker, epidemiology, economic, surveillance), plus the drug under review | LLM |
| Multi-source substantiation | Retrieves evidence per claim, routed to the datasets that claim type actually lives in | ClinicalTrials · PubMed · Wiley HLS · Open Targets · WHO GHO · DailyMed · FAERS |
| Reference verification | Entailment: does the retrieved evidence actually support the claim? Abstains when the evidence is absent | Valyu + LLM |
| Citation currency & quality | Deterministic gate on age, citation count and source tier of every citation — no LLM, no extra calls | — |

### Label & safety

| Feature | What it does | Evidence |
|---|---|---|
| Asset classification | Decides what was pasted — promotional piece, ISI, labeling excerpt, fragment, publication — and gates the promotional-materials checks on it | LLM |
| Fair-balance / ISI | Is safety information proportionate to the efficacy messaging, measured against the live label? Runs only on promotional material making benefit claims | DailyMed |
| On-/off-label detector | Flags claims that go beyond the approved indication | DailyMed |
| Adverse-event cross-check | Contradicts tolerability/safety claims against real post-market reports | openFDA FAERS |
| Boxed-warning & contraindication omission | Guards against required safety language the asset left out | DailyMed |
| Drug-interaction checker | Validates interaction claims against the label's DRUG INTERACTIONS section | DailyMed |
| Section-targeted label retrieval | The label is fetched as four separate windowed queries — indications, boxed warning/contraindications, warnings and precautions, adverse reactions — because a blended query returns the boxed warning every time and the rest never arrives | DailyMed |

### Regulatory & competitive

| Feature | What it does | Evidence |
|---|---|---|
| Enforcement-precedent grounding | Ties each concern the review raises to FDA guidance and OPDP warning/untitled letters | OPDP · FDA · open web |
| Multi-market review | Runs the same review for US, UK and EU, grounding non-US concerns in local law | UK legislation · UK case law |
| Comparative / superiority checker | A superiority claim needs head-to-head evidence — this looks for it and says so when it isn't there | ClinicalTrials · PubMed · Wiley HLS |
| IP / first-in-class / novelty checker | Validates "first-in-class" and novelty claims against the patent record | USPTO · EPO |
| Market-claim checker | "#1 prescribed", market-share and revenue claims against filed numbers | SEC filings · open web |

### Specialist claim lanes

| Feature | What it does | Evidence |
|---|---|---|
| Burden-of-disease / epidemiology | Prevalence and incidence claims against public health data | WHO GHO · PubMed |
| Companion-Dx / biomarker | Precision-medicine and biomarker claims | Open Targets · PubMed · Wiley HLS |
| Mechanism-of-action depth | MoA claims, including target binding affinity (Ki/IC50/Kd) in the deep lane | Open Targets · ChEMBL · BindingDB |

### Workspace

| Feature | What it does |
|---|---|
| Reviewer workspace | Accept/reject each finding, with the cited passage and source next to it |
| Audit trail | Every retrieval, verification and decision timestamped and streamed live |
| Export | Full review — findings, citations, decisions, audit — as JSON |
| Claims library | Claims substantiated in a past review are reused on the next one, matched by exact text then by embedding similarity (cosine ≥ 0.85), so you don't re-substantiate the same sentence forever |
| Provenance badge | Which datasets and how many sources backed this review (SOC 2 · ISO 27001 · GDPR · zero data retention) |

### DeepResearch lane

Some authoritative sources aren't reachable from the real-time search lane. Rather than fake them
with a weaker query, those checks are routed to async DeepResearch tasks that keep running while you
work elsewhere in the app.

| Feature | What it does | Evidence |
|---|---|---|
| Evidence dossier | One-click grounded dossier on any drug: indications, pivotal efficacy, safety and post-market signals, interactions, MoA with binding data, and explicit evidence gaps | All datasets + BindingDB |
| Surveillance-claim checker | "Cases are rising" and other trend claims — auto-routed here by the review, never faked inline | CDC wastewater / surveillance |
| Medical-device MLR mode | Device adverse events, malfunctions and safety signals | openFDA MAUDE |
| HCP verification & transparency | Verify an NPI, taxonomy and practice location for KOL vetting / Sunshine Act review | NPI Registry |
| Indication-language normalization | Maps promotional phrasing to coded indications and flags indication creep | WHO ICD |

## Calibration — measuring false positives, not just catches

A tool tuned only on copy that *should* flag optimises sensitivity and never measures specificity.
That is how this one once returned 19 findings on consumer ISI written from approved patient
labeling — an experienced reg ad/promo reviewer tried it, and every one of those findings was wrong.

`npm run eval` runs a corpus through the real review path and reports the trade-off both ways.

```bash
npm run dev                       # in one terminal
npm run eval                      # whole corpus, 2 runs each
npm run eval -- --runs 3          # tighter spread estimate
npm run eval -- --only clean      # just the specificity set
```

The corpus deliberately does not rest on the author's judgement:

- **clean** assets — copy that should return **zero** criticals, including FDA-approved Patient
  Information taken verbatim from the DailyMed SPL. Criticals on it are false positives by
  definition rather than by opinion.
- **defective** assets — copy FDA itself quoted as violative in OPDP warning and untitled letters
  (Breztri, Amvuttra, Brukinsa), with FDA's stated determination recorded in each file. Where FDA's
  finding was about the *totality* of a set of claims rather than any one of them, the corpus says
  so and asserts the set, not the sentence.

Defects are asserted at **claim level**: a defect counts as caught only when the offending claim
draws a critical-or-warning finding in *every* run. Category presence proved a weak proxy — it
scored 100% while a claim was going entirely unflagged.

Every asset runs N times and the harness reports **spread alongside the mean**, because claim
extraction and retrieval both vary run to run and a single run cannot distinguish a fix from noise.
The harness exits non-zero when the corpus doesn't pass, so it can gate a change.

See [`eval/README.md`](eval/README.md) for the corpus format and metric definitions.

> **On the corpus.** The clean assets were assembled by the same process that produced the bugs they
> exist to catch, and one already contained an error the tool correctly caught. A clean set written
> or reviewed by a regulatory professional is what would make the specificity number credible to
> one — contributions very welcome.

## Where this fits

The MLR category competes on workflow — routing, approvals, version control, e-signatures,
21 CFR Part 11 records, CMS integration. OpenMLR doesn't compete there and isn't a
replacement for any of it. It's an evidence layer that runs before, or alongside, the
system of record.

The bet is on a different question. Tools that link claims to references check a claim
against **your approved library**. This checks whether the underlying source document
actually says what the claim says — entailment against the primary literature, with the
passage and the citation shown next to the finding so a reviewer can disagree with it.

Whether that's worth having depends on how it performs on your copy, which is why
[calibration](#calibration--measuring-false-positives-not-just-catches) is in this README
and why `npm run eval` reports false positives alongside catches. Run it on assets you
know the answers to before trusting it on ones you don't.

## Stack

TypeScript · Next.js (App Router) · [`valyu-js`](https://www.npmjs.com/package/valyu-js) ·
[`openai`](https://www.npmjs.com/package/openai) (structured outputs) · `zod` at every LLM boundary ·
`streamdown` + `remark-gfm` for the report UI · optional Postgres for the audit trail and claims
library.

## Quick start

You need two keys before the first run:

| Key | Where to get it | What it pays for |
| --- | --- | --- |
| `VALYU_API_KEY` | [platform.valyu.ai](https://platform.valyu.ai/) | every retrieval — labels, literature, FAERS, patents |
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | claim extraction and entailment |

```bash
npm install
cp .env.example .env.local   # add VALYU_API_KEY and OPENAI_API_KEY
npm run dev                  # http://localhost:3000
```

Click **Run review** on the built-in fictional sample. (Don't paste confidential assets into a
hosted instance — self-host for real work.)

Changing anything in the pipeline? Run `npm run eval` before and after — see
[Calibration](#calibration--measuring-false-positives-not-just-catches).

### Modes: who pays for Valyu

OpenMLR runs in one of two modes, set by `NEXT_PUBLIC_APP_MODE`:

| Mode | Sign-in | Who pays for retrieval | Configure |
| --- | --- | --- | --- |
| `self-hosted` (default) | none | the deployment's `VALYU_API_KEY` | just `VALYU_API_KEY` |
| `valyu` | Valyu OAuth (PKCE) | each **reviewer's own Valyu credits** | the OAuth block in `.env.example` |

In **valyu mode** a reviewer signs in with their Valyu account; every search, dossier, and
DeepResearch task in that session is billed to *their* credits through the Valyu OAuth proxy — the
deployment never needs an API key. Set `NEXT_PUBLIC_APP_MODE=valyu` and fill in the OAuth values
(`NEXT_PUBLIC_VALYU_CLIENT_ID`, `VALYU_CLIENT_SECRET`, `NEXT_PUBLIC_VALYU_AUTH_URL`,
`VALYU_APP_URL`, `NEXT_PUBLIC_REDIRECT_URI`), registering the redirect URI on your Valyu OAuth app.

Anything other than `valyu` is treated as self-hosted, so a missing or misspelled mode fails safe to
the key-based path rather than locking everyone out. The billing decision lives in one place —
`src/lib/valyu-credentials.ts` — which every Valyu call routes through, so the two lanes stay
behaviourally identical.

### Deploy your own (Railway)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/openmlr?referralCode=yuv1Gy&utm_medium=integration&utm_source=template&utm_campaign=generic)

One click, then set two variables — `VALYU_API_KEY` ([get one](https://platform.valyu.ai/)) and `OPENAI_API_KEY`
([get one](https://platform.openai.com/api-keys)). Those are
always yours to supply: the template can provision the infrastructure, but not the
credentials that pay for retrieval and inference. If it doesn't include a database, add
one as in step 2 below; persistence is optional either way.

**Or deploy from your own fork.** The repo ships a [`railway.json`](railway.json), so
this is mostly clicking through — no Dockerfile, no build settings to fill in.

1. **Create the project.** Railway → **New Project** → **Deploy from GitHub repo**, and
   pick your fork. The `RAILPACK` builder in `railway.json` detects Next.js on its own.

2. **Add Postgres** — **New** → **Database** → **Add PostgreSQL**, in the same project.
   Optional: without it the pipeline still returns full reviews, you just lose the audit
   trail and claims library.

3. **Point the app at the database.** On the *app* service → **Variables** → add
   `DATABASE_URL` as a reference to the Postgres service's `DATABASE_URL` (Railway's
   variable picker; the value looks like `${{Postgres.DATABASE_URL}}`). Use the private
   `.railway.internal` host — `db:init` detects it and skips TLS, which the internal
   network doesn't need.

4. **Set the rest of the variables:**

   | Variable | Value |
   | --- | --- |
   | `VALYU_API_KEY` | your Valyu key from [platform.valyu.ai](https://platform.valyu.ai/) — this deployment pays for every search |
   | `OPENAI_API_KEY` | your OpenAI key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
   | `NEXT_PUBLIC_APP_MODE` | `self-hosted` (or omit — anything that isn't `valyu` fails safe to it) |

   Leave the OAuth block unset. It only applies to `valyu` mode, where reviewers sign in
   and spend their own credits.

5. **Generate a domain** — app service → **Settings** → **Networking** → **Generate
   Domain**. Railway sets `PORT` and `next start` honours it; nothing to configure.

Schema migration is wired to the pre-deploy hook (`npm run db:init`), so tables are
created and kept current on every deploy. It is a no-op when `DATABASE_URL` is unset,
which is what makes the database genuinely optional. Failed deploys retry three times
before Railway gives up.

> **Don't point a public instance at confidential assets.** Asset text is sent to Valyu
> and OpenAI, and a deployment with `VALYU_API_KEY` set bills every visitor's review to
> you. Put it behind access control, or run `valyu` mode so reviewers spend their own
> credits.

### Optional: persist the audit trail and claims library (local)

For local development. On Railway, step 2 above covers this.

```bash
docker compose up -d         # Postgres on :5432
export DATABASE_URL=postgres://openmlr:openmlr@localhost:5432/openmlr
npm run db:init              # create tables
```

Leave `DATABASE_URL` unset to run without a database — the pipeline still returns full results, but
the claims library has nothing to reuse.

## Layout

```
src/lib/schemas.ts        zod schemas for every LLM boundary
src/lib/llm.ts            OpenAI structured-output + embedding helpers
src/lib/valyu.ts          Valyu Search lane + claim→dataset routing
src/lib/valyu-credentials.ts  billing context — app key vs signed-in user's credits
src/lib/deepresearch.ts   DeepResearch lane (device · HCP · indication · surveillance · dossier)
src/lib/oauth.ts          Valyu OAuth (PKCE) — authorize redirect, code challenge
src/lib/app-mode.ts       self-hosted vs valyu mode
src/lib/pipeline/         one module per check + index.ts (orchestrator)
src/lib/pipeline/assetProfile.ts  what kind of asset this is; gates the promotional checks
src/lib/db/               optional Postgres persistence + claims library
src/app/api/              review · dossier · deepresearch · library · oauth (token · refresh)
src/app/auth/valyu/callback   OAuth redirect handler
src/app/stores/auth-store.ts  session + token refresh (zustand)
src/app/components/auth/  sign-in modal · account menu · initializer
src/app/views/            Review · Library · Dossier · Research tabs
scripts/eval.mjs          evaluation harness (npm run eval)
eval/corpus/              FDA-sourced test assets — clean + defective
eval/results/latest.json  current scoreboard
```

## Author

Built by **Prosper Otemuyiwa** ([@unicodeveloper](https://github.com/unicodeveloper)).

## License

MIT.
