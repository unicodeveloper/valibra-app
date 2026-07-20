# Substantia — open MLR review (Phase 0)

An open-source, self-hostable **MLR (Medical-Legal-Regulatory) pre-check** for pharma promotional
content, grounded entirely in [Valyu](https://www.valyu.ai)'s biomedical evidence network. It
verifies every claim against real, licensed primary sources — not a private library — and shows its
work.

This repo is **Phase 0: the substantiation spine** — the seven features a reviewer touches on every
asset:

| Step | Feature | What it does | Data |
|------|---------|--------------|------|
| Ingest | — | Take the asset text | — |
| F1 | Claim extraction & typing | Pull every discrete claim + the drug | LLM |
| F2 | Multi-source substantiation | Retrieve evidence per claim, routed by type | ClinicalTrials · PubMed · Wiley HLS · Open Targets · ChEMBL |
| F3 | Reference verification | Does the evidence actually support the claim? (entailment; abstains when absent) | Valyu + LLM |
| F5 | Fair-balance / ISI | Safety info proportionate to efficacy, vs the live label | DailyMed |
| F6 | On-/off-label detector | Claims beyond the approved indication | DailyMed |
| F15/F17 | Workspace + export | Accept/reject each finding, audit trail, export | — |

> Decision support for a human reviewer — **not** an autonomous regulatory determination.

## Trust invariants

- **Retrieve, then verify.** The LLM never generates a citation — every citation points at a
  document Valyu actually returned.
- **Abstain, don't bluff.** No evidence → `no_evidence`, never a confident guess.
- **Self-host + bring-your-own-key.** Your asset text and keys stay in your environment.

## Stack

TypeScript · Next.js (App Router) · [`valyu-js`](https://www.npmjs.com/package/valyu-js) ·
[`openai`](https://www.npmjs.com/package/openai) (structured outputs) · `zod` at every LLM boundary ·
`streamdown` + `remark-gfm` for the report UI · optional Postgres for the audit trail.

## Quick start

```bash
npm install
cp .env.example .env.local   # add VALYU_API_KEY and OPENAI_API_KEY
npm run dev                  # http://localhost:3000
```

Click **Run review** on the built-in fictional sample. (Don't paste confidential assets into a
hosted instance — self-host for real work.)

### Optional: persist the audit trail

```bash
docker compose up -d         # Postgres on :5432
export DATABASE_URL=postgres://mlr:mlr@localhost:5432/mlr
npm run db:init              # create tables
```

Leave `DATABASE_URL` unset to run without a database — the pipeline still returns full results.

## Layout

```
src/lib/schemas.ts        zod schemas for every LLM boundary
src/lib/llm.ts            OpenAI structured-output helper
src/lib/valyu.ts          Valyu client + claim→dataset routing
src/lib/pipeline/         extract (F1) · verify (F3) · fairbalance (F5) · offlabel (F6) · index (orchestrator)
src/lib/db/               optional Postgres persistence
src/app/api/review/       POST /api/review
src/app/page.tsx          reviewer workspace
```

## Roadmap

Phase 0 is the spine. Next: safety depth (adverse-event cross-check, interactions,
enforcement-precedent grounding), then competitive/IP and the claims library, then breadth
(devices, genomics, HCP). See the build plan for all 26 features.

## License

MIT.
