import { valyuSearch } from "./valyu-credentials";
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

/**
 * Every search below goes through `valyuSearch`, which decides who pays: the
 * deployment's own API key in self-hosted mode, or — when a reviewer has signed
 * in with Valyu — that reviewer's credits, via the OAuth proxy. Both lanes
 * return the same response shape, so nothing in this file has to care which
 * one served it. See src/lib/valyu-credentials.ts.
 */

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

/**
 * Terms worth centring a snippet on, pulled from the claim being checked.
 *
 * Statistical tokens are kept whole and weighted heavily below: the passage that
 * decides a quantitative claim is the one carrying the number, the comparator
 * and the p-value, and that is exactly what a keyword-only match tends to miss.
 */
const STAT_PATTERN =
  "\\b(?:p\\s*[<=>]\\s*0?\\.\\d+|95%\\s*ci|hazard ratio|odds ratio|\\bhr\\b|\\brr\\b|significan\\w*|placebo|primary endpoint|\\d+(?:\\.\\d+)?\\s*%)";
const STAT_RE = new RegExp(STAT_PATTERN, "gi");
/** Stateless twin of STAT_RE — `.test()` on a /g/ regex carries lastIndex between calls. */
const STAT_PROBE = new RegExp(STAT_PATTERN, "i");
const STOPWORDS = new Set([
  "with", "from", "that", "this", "than", "were", "have", "been", "their", "which",
  "when", "into", "more", "most", "such", "also", "these", "those", "over", "after",
  "patients", "study", "trial", "results", "treatment",
]);

function focusTerms(focus: string): { terms: string[]; stats: string[] } {
  const stats = [...focus.matchAll(STAT_RE)].map((m) => m[0].toLowerCase());
  const terms = [
    ...new Set(
      focus
        .toLowerCase()
        .split(/[^a-z0-9.%<>=-]+/)
        .filter((t) => t.length >= 4 && !STOPWORDS.has(t)),
    ),
  ];
  return { terms, stats };
}

/**
 * Build a snippet centred on the passages that actually bear on the claim.
 *
 * Head truncation is the wrong default for full-text literature: the primary
 * endpoint result, the comparison vs placebo and the p-value live in the Results
 * section, thousands of characters past the abstract. Cutting at the first N
 * characters handed verification a paper that genuinely was the right source and
 * genuinely did not contain the answer — so it abstained, and the claim came
 * back flagged. This is the same move `windowOn` makes for label sections,
 * generalised to an arbitrary claim.
 *
 * The head window is always kept (for a manuscript that is the abstract, which
 * usually states the headline result), then the best-scoring windows elsewhere
 * are appended in document order until the budget is spent.
 */
function focusSnippet(content: string, focus: string, budget: number): string {
  if (content.length <= budget) return content;

  const { terms, stats } = focusTerms(focus);
  if (terms.length === 0 && stats.length === 0) return content.slice(0, budget) + "…";

  const WIN = 700;
  const STEP = 350;
  const hay = content.toLowerCase();

  const score = (start: number): number => {
    const w = hay.slice(start, start + WIN);
    let s = 0;
    for (const t of terms) if (w.includes(t)) s += 1;
    // A window carrying the actual statistics is worth several keyword hits —
    // it is the passage a reviewer would point at to substantiate the claim.
    for (const t of stats) if (w.includes(t)) s += 4;
    // Any statistics at all make a window a better candidate for a quantitative
    // claim, even when the exact figure differs from the one claimed.
    if (STAT_PROBE.test(w)) s += 2;
    return s;
  };

  const head = { start: 0, end: Math.min(WIN, content.length) };
  const candidates: { start: number; s: number }[] = [];
  for (let i = STEP; i + 1 < content.length; i += STEP) candidates.push({ start: i, s: score(i) });
  candidates.sort((a, b) => b.s - a.s);

  const picked = [head];
  let used = head.end - head.start;
  for (const c of candidates) {
    if (c.s === 0 || used >= budget) break;
    const end = Math.min(c.start + WIN, content.length);
    // Skip anything already covered — overlapping windows waste the budget on
    // text the model has seen.
    if (picked.some((p) => c.start < p.end && end > p.start)) continue;
    picked.push({ start: c.start, end });
    used += end - c.start;
  }

  picked.sort((a, b) => a.start - b.start);
  return picked
    .map((p, i) => (i === 0 && p.start === 0 ? "" : "…") + content.slice(p.start, p.end).trim())
    .join(" ")
    .concat(picked[picked.length - 1].end < content.length ? "…" : "");
}

/**
 * `focus` is the claim under test. When supplied, the snippet is windowed onto
 * the passages relevant to it rather than truncated at the head.
 */
function toEvidence(r: RawResult, snippetChars = 1200, focus?: string): Evidence {
  const raw = r.content;
  const content = (typeof raw === "string" ? raw : raw == null ? "" : JSON.stringify(raw)).trim();
  const snippet = focus
    ? focusSnippet(content, focus, snippetChars)
    : content.length > snippetChars
      ? content.slice(0, snippetChars) + "…"
      : content;
  return {
    source: r.source ?? "",
    title: r.title ?? "(untitled)",
    url: r.url ?? "",
    snippet,
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
  focus?: string,
): Promise<Retrieval> {
  if (haltReason) return { evidence: [], error: haltReason };
  const res: any = await valyuSearch(query, {
    includedSources: sources,
    maxNumResults: maxResults,
  });
  if (res?.success === false) return failed(res);
  const results: RawResult[] = res?.results ?? [];
  return { evidence: results.map((r) => toEvidence(r, snippetChars, focus)), error: null };
}

/**
 * Re-window a label chunk around a named SPL section. DailyMed SPL docs lead
 * with the boxed warning, so naive head-truncation drops whatever section we
 * actually asked for. If the (larger) snippet contains the section, centre a
 * focused window on it.
 */
function windowOn(e: Evidence, re: RegExp, span = 1400): Evidence {
  const idx = e.snippet.search(re);
  if (idx < 0) return { ...e, snippet: e.snippet.slice(0, 1200) };
  const start = Math.max(0, idx - 120);
  return { ...e, snippet: (start > 0 ? "…" : "") + e.snippet.slice(start, start + span) + "…" };
}

/**
 * Retrieve supporting evidence for a claim, routed to the right datasets.
 *
 * `claimText` is the claim verbatim; it steers snippet windowing so verification
 * sees the passage that decides the claim rather than the head of the document.
 * The budget is larger than the 1200-char default because these are full-text
 * papers and the deciding passage is rarely alone — a result, its comparator and
 * its statistics can sit in different sections.
 */
export function substantiate(
  searchQuery: string,
  type: ClaimType,
  claimText = "",
): Promise<Retrieval> {
  const focus = [claimText, searchQuery].filter(Boolean).join(" ");
  return search(searchQuery, sourcesForClaim(type), 6, 2600, focus || undefined);
}

/**
 * Pull the drug's current FDA label (DailyMed). SPL documents are large and
 * chunked, so a single query skews to whichever section reranks highest
 * (usually the boxed warning). We fetch the four sections MLR actually needs and
 * window each onto its own text, merging de-duplicated by URL within each view.
 *
 * Each section gets its own query because blending them loses: the boxed warning
 * reranks above everything, so "boxed warning contraindications adverse
 * reactions" returned the boxed warning three times. WARNINGS AND PRECAUTIONS
 * was missing entirely, which is why the tool graded a line of FDA's own
 * approved patient labeling ("avoid activities where a sudden loss of
 * consciousness could cause serious harm") as contradicted by the label — the
 * section carrying it was never fetched. Most ISI copy lives in that section.
 */
const INDICATION_RE = /indications and usage|is indicated|indicated (as|for|to)|improve glycemic/i;
const ADVERSE_RE =
  /adverse reactions|most common adverse|commonly reported adverse|incidence of.{0,40}(adverse|reaction)|adverse events reported/i;
const BOXED_RE = /boxed warning|warning:|contraindicat|do not use|should not (be used|receive)/i;
const WARNINGS_RE =
  /warnings and precautions|warnings\b|precautions\b|has (been reported|happened|occurred)|monitor (patients|for)|discontinue|avoid|risk of/i;

export async function getLabel(drugName: string): Promise<Retrieval> {
  if (!drugName) return { evidence: [], error: null };
  const d = normalizeDrug(drugName);
  const [ind, safety, warnings, adverse] = await Promise.all([
    // Larger snippet so the indication (which trails the boxed warning in the
    // SPL) isn't truncated away; then window each chunk onto the indication.
    search(`${d} INDICATIONS AND USAGE approved indication`, [SOURCES.drugLabels], 5, 8000),
    search(`${d} boxed warning contraindications`, [SOURCES.drugLabels], 3, 8000),
    // WARNINGS AND PRECAUTIONS — the section nearly every ISI line comes from.
    search(
      `${d} WARNINGS AND PRECAUTIONS serious risks monitoring discontinue advise patients`,
      [SOURCES.drugLabels],
      4,
      8000,
    ),
    // Same trick as the indication: pull wide, then window onto the section.
    search(
      `${d} ADVERSE REACTIONS most common adverse reactions incidence in clinical trials`,
      [SOURCES.drugLabels],
      4,
      8000,
    ),
  ]);
  const error = ind.error || safety.error || warnings.error || adverse.error;
  if (error) return { evidence: [], error };

  // Keep EVERY view of the label: the indication window (for F6 / on-label
  // substantiation), the safety/boxed-warning chunks (F5 / F8), and the
  // adverse-reactions window (ISI and tolerability claims). These are the same
  // SPL docs, so we must NOT dedup across the groups — only within each — or
  // one view clobbers the others.
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
  const merged = [
    ...dedup(ind.evidence.map((e) => windowOn(e, INDICATION_RE))),
    ...dedup(safety.evidence.map((e) => windowOn(e, BOXED_RE, 1800))),
    ...dedup(warnings.evidence.map((e) => windowOn(e, WARNINGS_RE, 1800))),
    ...dedup(adverse.evidence.map((e) => windowOn(e, ADVERSE_RE, 1800))),
  ];
  return { evidence: merged, error: null };
}

/** F7 — post-market adverse-event reports for a drug (FAERS). */
export function getAdverseEvents(drugName: string): Promise<Retrieval> {
  if (!drugName) return Promise.resolve({ evidence: [], error: null });
  const d = normalizeDrug(drugName);
  return search(`${d} adverse events, serious reactions, safety signals`, [SOURCES.faers], 5);
}

/**
 * F19 — the label's DRUG INTERACTIONS section (DailyMed).
 *
 * Pull wide and window onto the section, exactly as getLabel does for the
 * indication and adverse reactions. At the previous 1200-char head truncation
 * this returned usable DRUG INTERACTIONS content in roughly one run in four —
 * the SPL leads with the boxed warning, so that is what the truncated chunk
 * contained, and F19 spent the other three runs reporting "no Drug Interactions
 * section content is supplied" on an asset claiming the drug "can be combined
 * with any medication without concern for interactions".
 */
const INTERACTIONS_RE =
  /drug interactions|concomitant (use|administration)|coadministration|interaction with|inhibitors of cyp|p-gp/i;

export function getInteractions(drugName: string): Promise<Retrieval> {
  if (!drugName) return Promise.resolve({ evidence: [], error: null });
  const d = normalizeDrug(drugName);
  return search(
    `${d} DRUG INTERACTIONS section: concomitant use, contraindicated and major interactions`,
    [SOURCES.drugLabels],
    4,
    8000,
  ).then((r) =>
    r.error ? r : { ...r, evidence: r.evidence.map((e) => windowOn(e, INTERACTIONS_RE, 1800)) },
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
  const res: any = await valyuSearch(query, {
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
