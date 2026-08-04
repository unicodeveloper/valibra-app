import { z } from "zod";

/**
 * Zod schemas for the Phase 0 MLR pipeline. Every LLM boundary is validated
 * through one of these — nothing untyped crosses from the model into the app.
 */

/**
 * Human-readable style for the `rationale` on any finding. These strings land
 * in the reviewer's queue directly under a flagged claim, so they have to read
 * like a reviewer's margin note — not like a model narrating its own evidence.
 * Shared across every pass so the voice is consistent.
 */
export const RATIONALE_STYLE =
  "one or two plain sentences, in the voice of an MLR reviewer's note. State the problem " +
  "directly and name what is missing or what conflicts. Never open by narrating the evidence — " +
  "do NOT start with 'The excerpts…', 'The evidence…', 'The label…', 'The data…', " +
  "'The provided/supplied/retrieved…', or 'The excerpts establish…'. Do NOT restate the claim " +
  "back, and drop throat-clearing connectives ('Thus', 'Therefore', 'As such', " +
  "'It is important to note', 'It should be noted'). Active voice. Lead with the finding itself. " +
  "Good: 'No head-to-head trial vs dulaglutide, so the superiority claim is unsupported.' " +
  "Bad: 'The supplied label excerpts do not establish a superiority claim; thus it is unsubstantiated.'";

const rationale = () => z.string().describe(`Why this finding — ${RATIONALE_STYLE}`);

/** A discrete promotional/scientific claim extracted from an asset. */
export const ClaimTypeSchema = z.enum([
  "efficacy",
  "safety",
  "comparative",
  "mechanism",
  "indication",
  "dosing",
  "economic",
  "epidemiology", // prevalence / burden-of-disease ("leading cause of…")
  "biomarker", // precision-medicine ("for patients with the EGFR mutation")
  "surveillance", // "cases are rising" / trend claims
  "other",
]);
export type ClaimType = z.infer<typeof ClaimTypeSchema>;

export const ClaimSchema = z.object({
  id: z.string().describe("Stable id for this claim, e.g. 'c1', 'c2'."),
  text: z.string().describe("The claim, quoted verbatim from the asset."),
  type: ClaimTypeSchema,
  searchQuery: z
    .string()
    .describe(
      "A concise literature-search query for this claim: the drug's GENERIC/active-ingredient " +
        "name plus the scientific concepts (condition, outcome, comparator). 4-8 terms. " +
        "These are matched against indexed document chunks, so include only what a paper about " +
        "the underlying science would contain, and EXCLUDE anything describing how THIS asset " +
        "presents it: timepoints and durations ('3.5 years', 'over 52 weeks', 'at week 12'), " +
        "figures and statistics ('36%', 'p=0.02', 'rate ratio 0.80', '49% relative difference'), " +
        "and trial-specific population labels ('stabilizer-naive', 'ITT population', 'all comers'). " +
        "Each of those narrows the query to text that appears in no document and the search " +
        "returns nothing. Keep the substantive outcome words — mortality, survival, exacerbations, " +
        "glycemic control — since a query without them retrieves the wrong literature, which is " +
        "worse than a query that finds nothing. Named trials (SUSTAIN-6, ETHOS) are fine. " +
        "Strip brand names and marketing adjectives. E.g. 'metformin glycemic control type 2 " +
        "diabetes'; for 'The risk of death was lower over 3.5 years with AMVUTTRA, 36% Lower Risk " +
        "compared to placebo' write 'vutrisiran transthyretin amyloid cardiomyopathy mortality placebo'.",
    ),
  location: z
    .string()
    .describe("Where the claim appears (heading, bullet, caption). '' if unknown."),
});
export type Claim = z.infer<typeof ClaimSchema>;

/** F1 — claim extraction & typing, plus the drug/product under review. */
export const ExtractionSchema = z.object({
  drugName: z
    .string()
    .describe("Primary drug/product/brand the asset promotes. '' if none found."),
  claims: z.array(ClaimSchema),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

/** A single retrieved piece of evidence from the Valyu network. */
export const EvidenceSchema = z.object({
  source: z.string(),
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  publicationDate: z.string().nullable(),
  citationCount: z.number().nullable(),
  /** Cosine score, set only on reference-pack matches so the reviewer can see
   *  how close the passage actually was. Absent for retrieved sources, which
   *  are ranked by the search API rather than scored here. */
  relevance: z.number().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** F3 — entailment verdict for a claim against its retrieved evidence. */
export const VerdictSchema = z.enum([
  "supported",
  "partial",
  "unsupported",
  "contradicted",
  "no_evidence",
]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const VerificationSchema = z.object({
  verdict: VerdictSchema,
  confidence: z.number().describe("Calibrated confidence 0..1 in the verdict."),
  rationale: rationale(),
  citedPassage: z
    .string()
    .describe("The exact evidence passage that decides the verdict. '' if none."),
  citedSourceUrl: z.string().describe("URL of the cited evidence. '' if none."),
});
export type Verification = z.infer<typeof VerificationSchema>;

/**
 * What kind of thing was pasted in.
 *
 * Fair balance is a rule about *promotional materials*: it asks whether safety
 * information is presented proportionately to benefit claims. Applied to
 * anything else it is structurally guaranteed to fail — a labeling excerpt, a
 * standalone ISI, a single claim or an endpoint summary can never be "balanced",
 * because there is nothing to balance or nothing to balance it against. Running
 * it anyway flagged every clean asset in the eval corpus, and punished exactly
 * the paste-a-paragraph workflow reviewers use most.
 *
 * So we classify the asset first and gate the promotional-materials checks on
 * it. The model reports the facts; which checks apply is decided in code, where
 * it can be read and argued with.
 */
export const AssetKindSchema = z.enum([
  "promotional", // a promotional piece: sales aid, detail aid, ad, banner, patient brochure
  "isi_only", // Important Safety Information / safety copy standing on its own
  "labeling", // prescribing information or approved labeling text
  "fragment", // a single claim, sentence, or short excerpt — not a complete piece
  "scientific", // publication text, abstract, data summary, congress material
]);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const AssetProfileSchema = z.object({
  kind: AssetKindSchema,
  makesBenefitClaims: z
    .boolean()
    .describe("Does the asset assert efficacy, benefit, or superiority to promote the product?"),
  hasSafetySection: z
    .boolean()
    .describe("Does the asset contain a safety block (ISI, warnings, contraindications, side effects)?"),
  isCompletePiece: z
    .boolean()
    .describe("Is this a complete, self-contained asset rather than an excerpt or fragment?"),
  rationale: rationale(),
});
export type AssetProfile = z.infer<typeof AssetProfileSchema>;

/** F5 — fair-balance / ISI check against the live DailyMed label. */
export const FairBalanceSchema = z.object({
  hasSafetyContext: z
    .boolean()
    .describe("Does the label context needed to judge fair balance exist?"),
  balanced: z.boolean().describe("Is safety info present and proportionate to efficacy claims?"),
  missingSafetyInfo: z
    .array(z.string())
    .describe("Required safety items (boxed warnings, contraindications, key ADRs) absent from the asset."),
  rationale: rationale(),
});
export type FairBalance = z.infer<typeof FairBalanceSchema>;

/** F6 — on-/off-label detector against the approved indication. */
export const OffLabelSchema = z.object({
  labelIndication: z.string().describe("The approved indication from the label. '' if unknown."),
  status: z.enum(["on_label", "off_label", "unclear"]),
  offLabelClaims: z
    .array(z.object({ claimId: z.string(), why: z.string() }))
    .describe("Claims that go beyond the approved indication/dosing."),
  rationale: rationale(),
});
export type OffLabel = z.infer<typeof OffLabelSchema>;

/** F7 — adverse-event contradiction (FAERS) vs tolerability/safety claims. */
export const AdverseEventCheckSchema = z.object({
  consistent: z.boolean().describe("Are the asset's safety/tolerability claims consistent with FAERS?"),
  contradictions: z
    .array(z.object({ claimId: z.string(), signal: z.string(), why: z.string() }))
    .describe("Claims contradicted by post-market adverse-event signals."),
  rationale: rationale(),
});
export type AdverseEventCheck = z.infer<typeof AdverseEventCheckSchema>;

/** F8 — black-box / contraindication omission guard vs the label. */
export const SafetyOmissionSchema = z.object({
  omittedBoxedWarnings: z
    .array(z.string())
    .describe("Boxed/black-box warnings present in the label but absent from the asset."),
  omittedContraindications: z
    .array(z.string())
    .describe("Contraindications present in the label but absent from the asset."),
  rationale: rationale(),
});
export type SafetyOmission = z.infer<typeof SafetyOmissionSchema>;

/** F19 — drug-interaction checker vs the label's DRUG INTERACTIONS section. */
export const InteractionCheckSchema = z.object({
  findings: z
    .array(z.object({ claimId: z.string(), verdict: z.string(), why: z.string() }))
    .describe("Interaction claims in the asset that conflict with the label."),
  notableInteractions: z
    .array(z.string())
    .describe("Clinically important interactions from the label relevant to the asset's use."),
  rationale: rationale(),
});
export type InteractionCheck = z.infer<typeof InteractionCheckSchema>;

/** F9 — regulatory grounding: tie the review's concerns to FDA guidance / OPDP precedent. */
export const RegulatoryGroundingSchema = z.object({
  groundings: z
    .array(
      z.object({
        concern: z.string().describe("The MLR concern being grounded."),
        guidanceOrPrecedent: z
          .string()
          .describe("The FDA guidance or OPDP warning/untitled-letter precedent."),
        sourceUrl: z.string().describe("URL of the guidance/precedent. '' if none."),
        why: z.string(),
      }),
    )
    .describe("Each concern tied to a specific rule or enforcement precedent."),
  rationale: rationale(),
});
export type RegulatoryGrounding = z.infer<typeof RegulatoryGroundingSchema>;

/** F10 — comparative / superiority claim checker (needs head-to-head evidence). */
export const ComparativeCheckSchema = z.object({
  findings: z
    .array(
      z.object({
        claimId: z.string(),
        comparator: z.string().describe("The named comparator drug/therapy."),
        verdict: z
          .enum(["head_to_head_supported", "no_head_to_head", "contradicted", "indirect_only"])
          .describe("Whether direct head-to-head evidence substantiates the superiority claim."),
        why: z.string(),
      }),
    )
    .describe("One entry per comparative/superiority claim."),
  rationale: rationale(),
});
export type ComparativeCheck = z.infer<typeof ComparativeCheckSchema>;

/** F11 — IP / first-in-class / novelty checker (patents). */
export const IpCheckSchema = z.object({
  findings: z
    .array(
      z.object({
        claimId: z.string(),
        verdict: z.enum(["supported", "unsupported", "no_evidence"]),
        why: z.string(),
      }),
    )
    .describe("One entry per novelty/first-in-class/IP claim."),
  rationale: rationale(),
});
export type IpCheck = z.infer<typeof IpCheckSchema>;

/** F12 — market-claim checker ("#1 prescribed", market share) vs SEC/company data. */
export const MarketClaimSchema = z.object({
  findings: z
    .array(
      z.object({
        claimId: z.string(),
        verdict: z.enum(["supported", "unsupported", "no_evidence"]),
        why: z.string(),
      }),
    )
    .describe("One entry per market-position/share claim."),
  rationale: rationale(),
});
export type MarketClaim = z.infer<typeof MarketClaimSchema>;

/** Unified finding surfaced in the reviewer workspace. */
export type FindingCategory =
  | "substantiation"
  | "fair-balance"
  | "off-label"
  | "citation-quality"
  | "adverse-event"
  | "safety-omission"
  | "drug-interaction"
  | "regulatory"
  | "comparative"
  | "ip"
  | "market-claim"
  | "mechanism"
  | "epidemiology"
  | "biomarker"
  | "surveillance";

/** F26 — provenance of the evidence used, for the licensed-evidence trust badge. */
export interface Provenance {
  datasets: string[];
  sourceCount: number;
  /** Passages from the reviewer's own reference pack, counted apart from
   *  licensed sources so the badge never overstates independent grounding. */
  referenceCount?: number;
  markets: string[];
  note: string;
}

/**
 * A check that requires the async DeepResearch lane (its authoritative source is
 * a DeepResearch-only Valyu dataset). Surfaced to the reviewer to kick off — it
 * is NOT run inline, and is never faked with a real-time Search query.
 */
export interface DrRequired {
  kind: "device" | "hcp" | "indication" | "surveillance" | "dossier";
  input: string;
  feature: string;
  reason: string;
}
/**
 * Severity has four tiers, not three, because "this claim is wrong" and "we
 * could not substantiate this claim" are different facts about different
 * things. The first is a defect in the copy. The second is a gap in what
 * retrieval found — often because the asset's own reference wasn't in the
 * datasets we searched, or because the deciding passage sat outside the
 * retrieved excerpt.
 *
 * Collapsing them (every abstention graded `critical`) is what makes a clean,
 * label-faithful asset come back covered in red. `unverified` keeps the
 * abstention visible and actionable — attach a reference — without dressing it
 * up as a finding against the copy.
 */
export type Severity = "info" | "warning" | "unverified" | "critical";

export interface Finding {
  id: string;
  category: FindingCategory;
  severity: Severity;
  claimId: string | null;
  claimText: string | null;
  headline: string;
  detail: string;
  confidence: number | null;
  evidence: Evidence[];
  /**
   * Set when this claim was already substantiated in the claims library (F16 reuse).
   * `similarity` is 1 for an exact-text match, or the cosine score for a semantic (v2) match.
   */
  libraryMatch?: {
    verdict: string;
    savedAt: string;
    similarity: number;
    matchedText?: string;
    /** "confirmed" = a reviewer accepted it previously; "provisional" = pipeline only. */
    status?: string;
  } | null;
}

export interface AuditEntry {
  ts: string;
  step: string;
  detail: string;
}

export interface ReviewResult {
  reviewId: string;
  assetName: string;
  /** The reviewed text itself — kept so a stored review can be reopened and re-anchored. */
  assetText: string;
  drugName: string;
  claims: Claim[];
  substantiation: Record<
    string,
    {
      evidence: Evidence[];
      verification: Verification;
      error: string | null;
      /**
       * True when the substantiation search ran successfully and returned NOTHING
       * — no error, no results. Distinct from a search that returned sources
       * which turned out not to address the claim: the first is a gap in what we
       * can reach, the second is a gap in the evidence base. Both used to render
       * identically as "not substantiated", so a reviewer could not tell that the
       * tool had effectively not looked.
       *
       * Note this tracks the SEARCH, not `evidence` — label excerpts are appended
       * afterwards for on-label claim types, so `evidence` can be non-empty while
       * the search itself found nothing.
       */
      noSourcesRetrieved?: boolean;
    }
  >;
  /** What kind of asset this is — gates the promotional-materials checks (F5/F8). */
  assetProfile: AssetProfile | null;
  fairBalance: FairBalance | null;
  offLabel: OffLabel | null;
  adverseEvents: AdverseEventCheck | null;
  safetyOmission: SafetyOmission | null;
  interactions: InteractionCheck | null;
  regulatory: RegulatoryGrounding | null;
  // Phase 2
  comparative: ComparativeCheck | null;
  ip: IpCheck | null;
  marketClaim: MarketClaim | null;
  // Phase 3
  provenance: Provenance; // F26
  deepResearchRequired: DrRequired[]; // DR-lane checks to kick off (e.g. F25 surveillance)
  findings: Finding[];
  /** Non-fatal retrieval problems (unauthorized datasets, rate limits, no matching label). */
  retrievalErrors: string[];
  /**
   * Set when retrieval was halted mid-run by a credit failure, in which case the
   * remaining searches were skipped rather than retried. Distinct from
   * `retrievalErrors`: this is a billing state the reviewer can act on, not
   * evidence that happened to be thin.
   */
  retrievalHalt: string | null;
  audit: AuditEntry[];
}
