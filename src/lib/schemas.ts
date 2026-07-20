import { z } from "zod";

/**
 * Zod schemas for the Phase 0 MLR pipeline. Every LLM boundary is validated
 * through one of these — nothing untyped crosses from the model into the app.
 */

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
        "name plus the scientific concepts (condition, outcome, comparator). Strip brand names, " +
        "marketing adjectives, and quantitative puffery. E.g. 'metformin glycemic control type 2 diabetes'.",
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
  rationale: z.string().describe("Why this verdict — cite the evidence, never guess."),
  citedPassage: z
    .string()
    .describe("The exact evidence passage that decides the verdict. '' if none."),
  citedSourceUrl: z.string().describe("URL of the cited evidence. '' if none."),
});
export type Verification = z.infer<typeof VerificationSchema>;

/** F5 — fair-balance / ISI check against the live DailyMed label. */
export const FairBalanceSchema = z.object({
  hasSafetyContext: z
    .boolean()
    .describe("Does the label context needed to judge fair balance exist?"),
  balanced: z.boolean().describe("Is safety info present and proportionate to efficacy claims?"),
  missingSafetyInfo: z
    .array(z.string())
    .describe("Required safety items (boxed warnings, contraindications, key ADRs) absent from the asset."),
  rationale: z.string(),
});
export type FairBalance = z.infer<typeof FairBalanceSchema>;

/** F6 — on-/off-label detector against the approved indication. */
export const OffLabelSchema = z.object({
  labelIndication: z.string().describe("The approved indication from the label. '' if unknown."),
  status: z.enum(["on_label", "off_label", "unclear"]),
  offLabelClaims: z
    .array(z.object({ claimId: z.string(), why: z.string() }))
    .describe("Claims that go beyond the approved indication/dosing."),
  rationale: z.string(),
});
export type OffLabel = z.infer<typeof OffLabelSchema>;

/** F7 — adverse-event contradiction (FAERS) vs tolerability/safety claims. */
export const AdverseEventCheckSchema = z.object({
  consistent: z.boolean().describe("Are the asset's safety/tolerability claims consistent with FAERS?"),
  contradictions: z
    .array(z.object({ claimId: z.string(), signal: z.string(), why: z.string() }))
    .describe("Claims contradicted by post-market adverse-event signals."),
  rationale: z.string(),
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
  rationale: z.string(),
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
  rationale: z.string(),
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
  rationale: z.string(),
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
  rationale: z.string(),
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
  rationale: z.string(),
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
  rationale: z.string(),
});
export type MarketClaim = z.infer<typeof MarketClaimSchema>;

/** F18 — deep-research evidence dossier on a drug/molecule. */
export const DossierSchema = z.object({
  indication: z.string().describe("Approved indication(s) from the label. '' if unknown."),
  efficacySummary: z.string().describe("Key efficacy evidence, grounded in the sources."),
  safetySummary: z.string().describe("Safety profile: boxed warnings, key ADRs, signals."),
  interactionsSummary: z.string().describe("Clinically important drug interactions."),
  evidenceGaps: z.array(z.string()).describe("Where evidence is thin, dated, or absent."),
});
export type Dossier = z.infer<typeof DossierSchema>;

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
export type Severity = "info" | "warning" | "critical";

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
    { evidence: Evidence[]; verification: Verification; error: string | null }
  >;
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
