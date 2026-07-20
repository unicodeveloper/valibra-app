import { Valyu } from "valyu-js";
import type { ClaimType, Evidence } from "./schemas";

/**
 * Valyu is the evidence spine. Every substantiation and label lookup routes
 * through here, scoped to the right named dataset — so every citation points at
 * a real, licensed primary source (DailyMed, ClinicalTrials.gov, PubMed, Wiley),
 * never at model output.
 */

/**
 * Normalize a drug name for retrieval. Claim extraction can return a messy name
 * pulled from an asset headline (e.g. "METFORMIN (metformin hydrochloride) —
 * proven control"); a garbled query degrades DailyMed retrieval badly. Strip
 * parentheticals, tagline text after a dash, and collapse whitespace.
 */
function normalizeDrug(name: string): string {
  const cleaned = name
    .replace(/\([^)]*\)/g, " ") // drop parentheticals
    .split(/[—–-]/)[0] // drop tagline after an em/en/hyphen dash
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || name.trim();
}

let _client: Valyu | null = null;
function client(): Valyu {
  if (!_client) {
    const apiKey = process.env.VALYU_API_KEY;
    if (!apiKey) throw new Error("VALYU_API_KEY is not set");
    _client = new Valyu(apiKey);
  }
  return _client;
}

// Dataset ids in the Valyu network (Search/Answer lane — real-time inline).
export const SOURCES = {
  drugLabels: "valyu/valyu-drug-labels", // DailyMed — FDA labels
  clinicalTrials: "valyu/valyu-clinical-trials",
  pubmed: "valyu/valyu-pubmed",
  wileyHls: "wiley/wiley-hls", // peer-reviewed, licensed full text
  openTargets: "valyu/valyu-open-targets",
  faers: "valyu/valyu-openfda-drug-events",
  chembl: "valyu/valyu-chembl",
  uspto: "valyu/valyu-patents",
  epo: "valyu/valyu-patents-epo",
  sec: "valyu/valyu-sec-filings",
  who: "valyu/valyu-who-health-data", // WHO GHO — epidemiology
  ukLegislation: "valyu/valyu-uk-legislation",
  ukCaseLaw: "valyu/valyu-uk-case-law",
} as const;

/** Which datasets to search for a given claim type. */
function sourcesForClaim(type: ClaimType): string[] {
  switch (type) {
    case "efficacy":
    case "comparative":
      // Substantiate against the primary literature. (We deliberately do NOT add
      // the label here: Valyu's label chunks skew to the boxed-warning section
      // and crowd out the efficacy evidence. On-label indication is handled by
      // F5/F6, which query the label with an indication-targeted prompt.)
      return [SOURCES.clinicalTrials, SOURCES.pubmed, SOURCES.wileyHls];
    case "mechanism": // F24 — MoA depth (BindingDB is DeepResearch-only; Open Targets covers MoA)
      return [SOURCES.openTargets, SOURCES.pubmed];
    case "biomarker": // F20 — companion-Dx / precision-medicine
      return [SOURCES.openTargets, SOURCES.pubmed, SOURCES.wileyHls];
    case "epidemiology": // F13 — burden of disease
      return [SOURCES.who, SOURCES.pubmed];
    // NOTE: "surveillance" (F25) is intentionally NOT here — its authoritative
    // source (CDC Wastewater) is DeepResearch-only, so it is routed to the DR
    // lane in the orchestrator, never faked with a Search query.
    case "safety":
      return [SOURCES.drugLabels, SOURCES.faers];
    case "dosing":
    case "indication":
      return [SOURCES.drugLabels, SOURCES.pubmed];
    case "economic":
    case "other":
    default:
      return [SOURCES.pubmed, SOURCES.wileyHls];
  }
}

// The valyu-js response shape is intentionally loosely typed here — we map the
// fields we rely on and tolerate absence.
interface RawResult {
  title?: string;
  url?: string;
  content?: unknown; // string for most datasets; object/array for structured ones
  source?: string;
  publication_date?: string | null;
  citation_count?: number | null;
}

function toEvidence(r: RawResult, snippetChars = 1200): Evidence {
  const raw = r.content;
  const content = (typeof raw === "string" ? raw : raw == null ? "" : JSON.stringify(raw)).trim();
  return {
    source: r.source ?? "",
    title: r.title ?? "(untitled)",
    url: r.url ?? "",
    snippet: content.length > snippetChars ? content.slice(0, snippetChars) + "…" : content,
    publicationDate: r.publication_date ?? null,
    citationCount: r.citation_count ?? null,
  };
}

/**
 * A retrieval result carries evidence AND an error slot. A failed search
 * (no credits, unauthorized dataset, rate limit) must never be silently
 * flattened into "no evidence" — a reviewer has to know the difference between
 * "we searched and found nothing" and "we couldn't search."
 */
export interface Retrieval {
  evidence: Evidence[];
  error: string | null;
}

/**
 * Retrieval circuit breaker.
 *
 * A review fans out to 10–20 searches, most of them concurrent. If the account
 * runs out of credits partway through, every remaining search spends a
 * round-trip to fail identically, and the reviewer is left reading a wall of
 * `no_evidence` verdicts that look like abstentions rather than a billing
 * problem. Once we see a credit failure we latch it and short-circuit the rest
 * of the run, so the orchestrator can report "out of credits" as one distinct,
 * actionable state.
 *
 * The latch is cleared at the start of every run rather than living for the
 * process lifetime — a topped-up account must never stay stuck on a stale
 * latch. Concurrent runs share it, which is correct: credits are per-account,
 * so a failure in one run really does apply to the others.
 */
const CREDIT_ERROR_RE =
  /insufficient credit|out of credits|top ?up|payment required|quota exceeded|billing/i;

let haltReason: string | null = null;

/** True when an error message means "the account can't pay for this search". */
export function isCreditError(message: string): boolean {
  return CREDIT_ERROR_RE.test(message);
}

/** Clear the circuit breaker. Call once at the start of each review run. */
export function beginRetrievalRun(): void {
  haltReason = null;
}

/** The credit failure that halted retrieval this run, if any. */
export function retrievalHalt(): string | null {
  return haltReason;
}

/**
 * Map a failed Valyu response to a Retrieval, latching the breaker when the
 * failure is a credit failure (i.e. every subsequent search would fail too).
 */
function failed(res: any): Retrieval {
  const error = res?.error || "Valyu search failed.";
  if (isCreditError(error)) haltReason = error;
  return { evidence: [], error };
}

async function search(
  query: string,
  sources: string[],
  maxResults = 5,
  snippetChars = 1200,
): Promise<Retrieval> {
  if (haltReason) return { evidence: [], error: haltReason };
  const res: any = await client().search(query, {
    includedSources: sources,
    maxNumResults: maxResults,
  });
  if (res?.success === false) return failed(res);
  const results: RawResult[] = res?.results ?? [];
  return { evidence: results.map((r) => toEvidence(r, snippetChars)), error: null };
}

/**
 * Re-window a label chunk around the INDICATIONS text. DailyMed SPL docs lead
 * with the boxed warning, so naive head-truncation drops the indication. If the
 * (larger) snippet contains the indication, center a focused window on it.
 */
function windowOnIndication(e: Evidence): Evidence {
  const idx = e.snippet.search(INDICATION_RE);
  if (idx < 0) return { ...e, snippet: e.snippet.slice(0, 1200) };
  const start = Math.max(0, idx - 120);
  return { ...e, snippet: (start > 0 ? "…" : "") + e.snippet.slice(start, start + 1400) + "…" };
}

/** Retrieve supporting evidence for a claim, routed to the right datasets. */
export function substantiate(searchQuery: string, type: ClaimType): Promise<Retrieval> {
  return search(searchQuery, sourcesForClaim(type), 6);
}

/**
 * Pull the drug's current FDA label (DailyMed). SPL documents are large and
 * chunked, so a single query skews to whichever section reranks highest
 * (usually the boxed warning). We fetch the two sections MLR actually needs —
 * INDICATIONS AND USAGE (for off-label + on-label substantiation) and the
 * safety sections (for fair balance) — and merge, de-duplicated by URL.
 */
const INDICATION_RE = /indications and usage|is indicated|indicated (as|for|to)|improve glycemic/i;

export async function getLabel(drugName: string): Promise<Retrieval> {
  if (!drugName) return { evidence: [], error: null };
  const d = normalizeDrug(drugName);
  const [ind, safety] = await Promise.all([
    // Larger snippet so the indication (which trails the boxed warning in the
    // SPL) isn't truncated away; then window each chunk onto the indication.
    search(`${d} INDICATIONS AND USAGE approved indication`, [SOURCES.drugLabels], 5, 8000),
    search(`${d} boxed warning contraindications adverse reactions`, [SOURCES.drugLabels], 3),
  ]);
  const error = ind.error || safety.error;
  if (error) return { evidence: [], error };

  // Keep BOTH views of the label: the indication window (for F6 / on-label
  // substantiation) AND the safety/boxed-warning chunks (for F5 / F8). These
  // are the same SPL docs, so we must NOT dedup across the two groups — only
  // within each — or one view clobbers the other.
  const dedup = (list: Evidence[]): Evidence[] => {
    const seen = new Set<string>();
    const out: Evidence[] = [];
    for (const e of list) {
      const key = e.url || e.title;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
    return out;
  };
  const merged = [...dedup(ind.evidence.map(windowOnIndication)), ...dedup(safety.evidence)];
  return { evidence: merged, error: null };
}

/** F7 — post-market adverse-event reports for a drug (FAERS). */
export function getAdverseEvents(drugName: string): Promise<Retrieval> {
  if (!drugName) return Promise.resolve({ evidence: [], error: null });
  const d = normalizeDrug(drugName);
  return search(`${d} adverse events, serious reactions, safety signals`, [SOURCES.faers], 5);
}

/** F19 — the label's DRUG INTERACTIONS section (DailyMed). */
export function getInteractions(drugName: string): Promise<Retrieval> {
  if (!drugName) return Promise.resolve({ evidence: [], error: null });
  const d = normalizeDrug(drugName);
  return search(
    `${d} DRUG INTERACTIONS section: contraindicated and major interactions`,
    [SOURCES.drugLabels],
    3,
  );
}

/** F10 — head-to-head evidence for a comparative/superiority claim. */
export function getHeadToHead(drug: string, comparator: string): Promise<Retrieval> {
  const d = normalizeDrug(drug);
  return search(
    `${d} versus ${comparator} head-to-head randomized controlled trial comparative efficacy`,
    [SOURCES.clinicalTrials, SOURCES.pubmed, SOURCES.wileyHls],
    6,
  );
}

/** F11 — patent evidence for novelty / first-in-class / IP claims. */
export function getPatents(query: string): Promise<Retrieval> {
  return search(query, [SOURCES.uspto, SOURCES.epo], 6);
}

/** F18 — gather broad evidence across datasets for a deep-research dossier. */
export async function gatherDossierEvidence(drugName: string): Promise<Retrieval> {
  const d = normalizeDrug(drugName);
  const [label, efficacy, faers] = await Promise.all([
    getLabel(d),
    search(`${d} efficacy outcomes pivotal clinical trials`, [SOURCES.clinicalTrials, SOURCES.pubmed, SOURCES.wileyHls], 6),
    getAdverseEvents(d),
  ]);
  const error = label.error || efficacy.error || faers.error;
  const evidence = [...label.evidence, ...efficacy.evidence, ...faers.evidence];
  return { evidence, error: error || null };
}

/** F12 — SEC filings + open web for market-position / share claims. */
export async function getMarketEvidence(query: string): Promise<Retrieval> {
  const [sec, web] = await Promise.all([
    search(query, [SOURCES.sec], 4),
    searchRegulatory(query), // open web
  ]);
  const error = sec.error || web.error;
  return { evidence: [...sec.evidence, ...web.evidence], error: error || null };
}

/**
 * F9 — enforcement-precedent grounding. OPDP warning/untitled letters and FDA
 * promotional guidance are public web content, so this searches the open web
 * (no includedSources) rather than a named dataset.
 */
export async function searchRegulatory(query: string): Promise<Retrieval> {
  if (haltReason) return { evidence: [], error: haltReason };
  const res: any = await client().search(query, {
    searchType: "web",
    maxNumResults: 6,
    // Steer retrieval toward actual enforcement precedent, not drug labels.
    instructions:
      "Prioritize actual FDA OPDP warning letters, untitled letters, and official FDA promotional/" +
      "advertising guidance documents. Exclude drug product labels and prescribing information.",
    sourceBiases: { "fda.gov": 3, "accessdata.fda.gov": 3 },
  });
  if (res?.success === false) return failed(res);
  const results: RawResult[] = res?.results ?? [];
  return { evidence: results.map((r) => toEvidence(r)), error: null };
}

/** F14 — UK/EU regulatory context (legislation + case law) for multi-market review. */
export function searchUkRegulatory(query: string): Promise<Retrieval> {
  return search(query, [SOURCES.ukLegislation, SOURCES.ukCaseLaw], 4);
}

/**
 * Guard against acting on the WRONG drug's label. DailyMed search can return a
 * near-neighbor label for a name that doesn't exist (e.g. a fictional brand),
 * which would produce spurious fair-balance / off-label findings. We only trust
 * a label when the drug's name actually appears in it.
 */
export function labelMatchesDrug(drugName: string, label: Evidence[]): boolean {
  if (label.length === 0) return false;
  const haystack = label.map((e) => `${e.title} ${e.snippet}`).join(" ").toLowerCase();
  // Significant tokens from the drug name (brand or generic), length >= 4.
  const tokens = drugName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4);
  if (tokens.length === 0) return false;
  return tokens.some((t) => haystack.includes(t));
}
