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
      "approved). Reference each flagged claim by its id. Do not invent approved uses.\n" +
      // The excerpts are retrieved windows, not the whole SPL. Read literally, a
      // claim quoting the real indication verbatim gets flagged as off-label
      // whenever the window happens to stop short of it — which is what flagged a
      // faithful atorvastatin indication statement as promoting unapproved uses.
      "These excerpts are RETRIEVED WINDOWS of the label, not the complete document. Sections " +
      "outside them were not fetched. Flag a claim as off-label only when the excerpts " +
      "AFFIRMATIVELY establish a conflict — the label approves something narrower and the claim " +
      "plainly exceeds it. Never flag a claim merely because the excerpts do not mention it: " +
      "silence is missing text, not a missing approval. When the excerpts are too incomplete to " +
      "decide, return status 'unclear' and flag nothing.",
    user:
      `FDA LABEL EXCERPTS:\n${labelBlock}\n\n` +
      `CLAIMS:\n${claimsBlock}\n\n` +
      "Determine on-/off-label status.",
  });
}
