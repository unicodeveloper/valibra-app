import { structured } from "../llm";
import { FairBalanceSchema, type Evidence, type FairBalance } from "../schemas";

/**
 * F5 — Fair-balance / ISI enforcement, checked against the live DailyMed label.
 * Does the asset present safety information proportionate to its efficacy claims,
 * and does it omit anything the current label requires?
 */
export function checkFairBalance(assetText: string, label: Evidence[]): Promise<FairBalance> {
  if (label.length === 0) {
    return Promise.resolve({
      hasSafetyContext: false,
      balanced: false,
      missingSafetyInfo: [],
      rationale: "No FDA label (DailyMed) was retrieved, so fair balance cannot be assessed.",
    });
  }

  const labelBlock = label.map((e, i) => `[${i + 1}] ${e.title}\n${e.snippet}`).join("\n\n---\n\n");

  return structured(FairBalanceSchema, {
    name: "fair_balance",
    effort: "medium", // safety judgment — keep accuracy up

    system:
      "You assess fair balance in pharmaceutical promotion. Using ONLY the supplied FDA label " +
      "excerpts as the source of truth for required safety information, judge whether the asset " +
      "presents safety information (boxed warnings, contraindications, important adverse " +
      "reactions) proportionate to its efficacy claims. List required safety items that are " +
      "present in the label but missing from the asset. Do not invent label content.",
    user:
      `FDA LABEL EXCERPTS:\n${labelBlock}\n\n` +
      `PROMOTIONAL ASSET:\n"""\n${assetText}\n"""\n\n` +
      "Assess fair balance.",
  });
}
