import { structured } from "../llm";
import { AssetProfileSchema, type AssetProfile } from "../schemas";

/**
 * Classify the asset before any promotional-materials rule is applied to it.
 *
 * Fair balance (F5) and the boxed-warning omission guard (F8) are rules about
 * promotional pieces. Run against a labeling excerpt, a bare ISI, a single claim
 * or a paragraph of publication text they cannot pass — safety is never
 * "proportionate to the efficacy claims" in a document that has no efficacy
 * claims, or no room for safety copy. Before this gate existed, every clean
 * asset in the eval corpus came back with a critical fair-balance finding.
 *
 * One call per review, independent of the drug, so it runs alongside label
 * retrieval rather than adding a step.
 */
export function profileAsset(assetText: string): Promise<AssetProfile> {
  return structured(AssetProfileSchema, {
    name: "asset_profile",
    // Cheap call, and everything downstream is gated on it — worth the accuracy.
    effort: "medium",
    system:
      "You classify what kind of pharmaceutical document has been submitted for review. You are " +
      "NOT judging whether it is compliant — only what it is.\n" +
      "- 'promotional': a piece intended to promote the product to prescribers or patients — sales " +
      "aid, detail aid, advertisement, banner, patient brochure, web page. It sells.\n" +
      "- 'isi_only': Important Safety Information, a safety block, or patient counselling copy " +
      "standing on its own, without accompanying promotional/benefit content.\n" +
      "- 'labeling': prescribing information or approved labeling text — indications, dosage and " +
      "administration, contraindications, adverse reactions — reproduced as labeling rather than " +
      "written to promote.\n" +
      "- 'fragment': a single claim, sentence, or short excerpt lifted out of a larger piece. Not " +
      "a complete, self-contained asset.\n" +
      "- 'scientific': publication text, abstract, study result summary, or congress material.\n" +
      "Judge by what the text IS, not by what product it concerns. A document that lists an " +
      "indication and a dosing regimen in labeling voice is 'labeling' even though it names a " +
      "drug. A headline plus bullets that sell a benefit is 'promotional' even if it is short.",
    user: `Classify this submitted document:\n\n"""\n${assetText}\n"""`,
  });
}

/**
 * Does the fair-balance rule (F5) apply to this asset?
 *
 * Only to a promotional piece that actually makes benefit claims. An ISI alone
 * is the safety half — there is nothing for it to be out of balance with.
 * Labeling is the source of truth, not a piece to be judged against it. A
 * fragment is by definition not the whole piece, so its balance is unknowable
 * from what was pasted.
 */
export function fairBalanceApplies(p: AssetProfile | null): boolean {
  if (!p) return true; // classification failed — fall back to the old behaviour
  return p.kind === "promotional" && p.makesBenefitClaims;
}

/**
 * Does the omitted-boxed-warning guard (F8) apply?
 *
 * Wider than fair balance: an ISI that drops the boxed warning is a real defect
 * even though the ISI has no benefit claims to balance. But a labeling excerpt,
 * a fragment, or publication text is not a piece that was ever obliged to carry
 * one.
 */
export function safetyOmissionApplies(p: AssetProfile | null): boolean {
  if (!p) return true;
  return p.kind === "promotional" || p.kind === "isi_only";
}

/** One line for the audit trail explaining what was gated and why. */
export function profileSummary(p: AssetProfile): string {
  return (
    `kind=${p.kind}; benefit-claims=${p.makesBenefitClaims}; safety-section=${p.hasSafetySection}; ` +
    `complete=${p.isCompletePiece}. ${p.rationale}`
  );
}
