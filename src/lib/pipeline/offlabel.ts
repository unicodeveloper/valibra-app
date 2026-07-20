import { structured } from "../llm";
import { OffLabelSchema, type Claim, type Evidence, type OffLabel } from "../schemas";

/**
 * F6 — On-/off-label detector. The highest-value flag: off-label promotion is
 * the #1 OPDP enforcement trigger. Compares each claim to the approved
 * indication & dosing in the DailyMed label.
 */
export function checkOffLabel(claims: Claim[], label: Evidence[]): Promise<OffLabel> {
  if (label.length === 0) {
    return Promise.resolve({
      labelIndication: "",
      status: "unclear",
      offLabelClaims: [],
      rationale: "No FDA label (DailyMed) was retrieved, so label status cannot be assessed.",
    });
  }

  const labelBlock = label.map((e, i) => `[${i + 1}] ${e.title}\n${e.snippet}`).join("\n\n---\n\n");
  const claimsBlock = claims.map((c) => `${c.id} (${c.type}): "${c.text}"`).join("\n");

  return structured(OffLabelSchema, {
    name: "off_label",
    effort: "medium", // highest-stakes judgment call — keep accuracy up

    system:
      "You detect off-label promotion. Using ONLY the supplied FDA label excerpts as the " +
      "approved indication and dosing, flag any claim that promotes use beyond what the label " +
      "approves (unapproved indication, population, or dosing; unsupported superiority framed as " +
      "approved). Reference each flagged claim by its id. If the label text is insufficient to " +
      "decide, return status 'unclear'. Do not invent approved uses.",
    user:
      `FDA LABEL EXCERPTS:\n${labelBlock}\n\n` +
      `CLAIMS:\n${claimsBlock}\n\n` +
      "Determine on-/off-label status.",
  });
}
