import { structured } from "../llm";
import { InteractionCheckSchema, type Claim, type Evidence, type InteractionCheck } from "../schemas";

/**
 * F19 — Drug-interaction checker. Validates any interaction claims in the asset
 * against the label's DRUG INTERACTIONS section, and surfaces clinically
 * important interactions relevant to the promoted use.
 */
export function checkInteractions(
  claims: Claim[],
  interactionLabel: Evidence[],
): Promise<InteractionCheck> {
  if (interactionLabel.length === 0) {
    return Promise.resolve({
      findings: [],
      notableInteractions: [],
      rationale: "No DRUG INTERACTIONS label section retrieved; interactions not checked.",
    });
  }

  const labelBlock = interactionLabel
    .map((e, i) => `[${i + 1}] ${e.title}\n${e.snippet}`)
    .join("\n\n---\n\n");
  const claimsBlock = claims.map((c) => `${c.id} (${c.type}): "${c.text}"`).join("\n");

  return structured(InteractionCheckSchema, {
    name: "interactions",
    system:
      "You check pharmaceutical promotional content against the FDA label's DRUG INTERACTIONS " +
      "section. Using ONLY the supplied label excerpts: (1) flag any interaction-related claim in " +
      "the asset that conflicts with the label; (2) list clinically important interactions from the " +
      "label that are relevant to how the asset promotes the drug. Do not invent interactions.",
    user: `LABEL DRUG-INTERACTIONS EXCERPTS:\n${labelBlock}\n\nCLAIMS:\n${claimsBlock}\n\nCheck interactions.`,
  });
}
