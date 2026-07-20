# Valibra - Open MLR Review

An open-source, self-hostable **MLR (Medical-Legal-Regulatory) pre-check** for pharma promotional
content. It verifies every claim against real, licensed primary sources, not a private library and shows its
work.

> Decision support for a human reviewer — **not** an autonomous regulatory determination.

## Trust invariants

- **Retrieve, then verify.** The LLM never generates a citation — every citation points at a
  document Valyu actually returned.
- **Abstain, don't bluff.** No evidence → `no_evidence`, never a confident guess.
- **A failed search is not "no evidence."** Retrieval errors surface separately, and the claim is
  marked un-checked rather than silently cleared.
- **Self-host + bring-your-own-key.** Your asset text and keys stay in your environment.

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
| Fair-balance / ISI | Is safety information proportionate to the efficacy messaging, measured against the live label? | DailyMed |
| On-/off-label detector | Flags claims that go beyond the approved indication | DailyMed |
| Adverse-event cross-check | Contradicts tolerability/safety claims against real post-market reports | openFDA FAERS |
| Boxed-warning & contraindication omission | Guards against required safety language the asset left out | DailyMed |
| Drug-interaction checker | Validates interaction claims against the label's DRUG INTERACTIONS section | DailyMed |

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

## How this compares

The MLR category competes on workflow — routing, approvals, version control. Valibra doesn't
fight there. It competes on **evidence**: every check below runs against a licensed primary source,
not a private claims library you have to build and keep current.

**●** core capability · **◐** partial or implied · **○** not advertised

| Capability | Valibra | Veeva | Revisto | ERMA | Papercurve |
|---|:--:|:--:|:--:|:--:|:--:|
| **Substantiation** |
| Claim extraction & typing | ● | ● | ● | ● | ◐ |
| Multi-source substantiation | ● | ◐ | ◐ | ◐ | ◐ |
| Reference verification against a primary source † | ● | ◐ | ◐ | ◐ | ◐ |
| **Citation currency & quality gate** | ● | ○ | ○ | ○ | ○ |
| **Label & safety** |
| Fair-balance / ISI vs live label | ● | ◐ | ● | ◐ | ◐ |
| On-/off-label detector | ● | ◐ | ◐ | ◐ | ○ |
| **Adverse-event cross-check (FAERS)** | ● | ○ | ○ | ○ | ○ |
| Boxed-warning & contraindication omission | ● | ○ | ◐ | ◐ | ○ |
| **Drug-interaction checker** | ● | ○ | ○ | ○ | ○ |
| **Regulatory & competitive** |
| Enforcement-precedent grounding | ● | ◐ | ◐ | ● | ○ |
| Multi-market review (US/UK/EU) | ● | ● | ◐ | ◐ | ○ |
| Comparative / superiority checker | ● | ◐ | ◐ | ◐ | ○ |
| **IP / first-in-class checker** | ● | ○ | ○ | ○ | ○ |
| **Market-claim checker** | ● | ○ | ○ | ○ | ○ |
| **Specialist claim lanes** |
| **Burden-of-disease / epidemiology** | ● | ○ | ○ | ○ | ○ |
| **Companion-Dx / biomarker** | ● | ○ | ○ | ○ | ○ |
| **Mechanism-of-action depth** | ● | ○ | ○ | ○ | ○ |
| **Workspace** |
| Reviewer workspace | ● | ● | ● | ● | ● |
| Passage-anchored annotation & export | ● | ● | ● | ● | ● |
| Claims library | ● | ● | ● | ○ | ◐ |
| **Licensed-evidence provenance** | ● | ○ | ○ | ○ | ○ |
| **DeepResearch lane** |
| **Evidence dossier** | ● | ○ | ○ | ○ | ○ |
| **Surveillance-claim checker** | ● | ○ | ○ | ○ | ○ |
| Medical-device MLR mode | ● | ◐ | ○ | ○ | ○ |
| **HCP verification (NPI)** | ● | ○ | ○ | ○ | ○ |
| **Indication-language normalization (ICD)** | ● | ○ | ○ | ○ | ○ |

**† The flagship difference is the one row where everyone scores.** All four incumbents link claims
to references — Veeva auto-suggests them and flags missing links, Revisto validates statements
against approved claims and references, Papercurve's Paige confidence-rates suggested references,
ERMA maps substantiation across sentences. Every one of those checks a claim against **your
approved library**. None of them publicly claims to check whether the *underlying source document
actually says what the claim says*. That gap — matching and linking vs. entailment against the
primary literature — is the whole reason this project exists, and an independent 2026 survey of the
category reaches the same conclusion.

**13 of the 26 checks have no advertised equivalent anywhere in the category** (bold rows). They
fall into three groups:

- **Safety data nobody wires in.** Post-market adverse events (FAERS) and label interactions are
  public, structured, and directly contradict "well-tolerated" copy. No competitor advertises them.
- **Claim types outside the label.** Patent, market-share, epidemiology, biomarker, mechanism and
  surveillance claims all ship in real promotional material and all draw scrutiny — but sit outside
  what a label-and-library tool can check.
- **Evidence you can audit.** A citation-quality gate, named datasets and source counts per review,
  because every citation points at a document the retrieval layer actually returned.

Where the category is strong — configurable workflows, e-signatures, 21 CFR Part 11 records,
enterprise CMS integration — the incumbents are ahead, and this is not a replacement for them. It is
the evidence layer that runs before, or alongside, the system of record.

> **On this table.** Marks reflect what each vendor **publicly advertises** on their own site and in
> trade coverage, last verified July 2026 against
> [Veeva AI for PromoMats](https://www.veeva.com/products/veeva-ai-for-promomats/),
> [Revisto](https://www.revisto.com/product), [ERMA](https://www.ermasystems.com/mlr-software) and
> [Papercurve](https://www.papercurve.com/product-claims).
> "Not advertised" is not proof a capability is absent — these are closed products and any of them
> may ship something unannounced, under a different name, or on a roadmap. Veeva in particular ships
> AI agents fast; this table will go stale. Corrections via PR are welcome.

## Stack

TypeScript · Next.js (App Router) · [`valyu-js`](https://www.npmjs.com/package/valyu-js) ·
[`openai`](https://www.npmjs.com/package/openai) (structured outputs) · `zod` at every LLM boundary ·
`streamdown` + `remark-gfm` for the report UI · optional Postgres for the audit trail and claims
library.

## Quick start

```bash
npm install
cp .env.example .env.local   # add VALYU_API_KEY and OPENAI_API_KEY
npm run dev                  # http://localhost:3000
```

Click **Run review** on the built-in fictional sample. (Don't paste confidential assets into a
hosted instance — self-host for real work.)

### Optional: persist the audit trail and claims library

```bash
docker compose up -d         # Postgres on :5432
export DATABASE_URL=postgres://valibra:valibra@localhost:5432/valibra
npm run db:init              # create tables
```

Leave `DATABASE_URL` unset to run without a database — the pipeline still returns full results, but
the claims library has nothing to reuse.

## Layout

```
src/lib/schemas.ts        zod schemas for every LLM boundary
src/lib/llm.ts            OpenAI structured-output + embedding helpers
src/lib/valyu.ts          Valyu client + claim→dataset routing
src/lib/deepresearch.ts   DeepResearch lane (device · HCP · indication · surveillance · dossier)
src/lib/pipeline/         one module per check + index.ts (orchestrator)
src/lib/db/               optional Postgres persistence + claims library
src/app/api/              review · dossier · deepresearch · library
src/app/views/            Review · Library · Dossier · Research tabs
```

## Author

Built by **Prosper Otemuyiwa** ([@unicodeveloper](https://github.com/unicodeveloper)).

## License

MIT.
