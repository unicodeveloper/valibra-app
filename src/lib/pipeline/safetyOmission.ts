import { structured } from "../llm";
import { SafetyOmissionSchema, type Evidence, type SafetyOmission } from "../schemas";

/**
 * F8 — Black-box / contraindication omission guard. Distinct from fair balance
 * (F5, proportionality): this flags the SPECIFIC required elements — boxed
 * warnings and contraindications present in the label but absent from the asset.
 */
export function checkSafetyOmission(assetText: string, label: Evidence[]): Promise<SafetyOmission> {
  if (label.length === 0) {
    return Promise.resolve({
      omittedBoxedWarnings: [],
      omittedContraindications: [],
      rationale: "No FDA label retrieved; boxed-warning / contraindication omissions not checked.",
    });
  }

  const labelBlock = label.map((e, i) => `[${i + 1}] ${e.title}\n${e.snippet}`).join("\n\n---\n\n");

  return structured(SafetyOmissionSchema, {
    name: "safety_omission",
    system:
      "You detect omission of REQUIRED safety elements in pharmaceutical promotion. Using ONLY the " +
      "supplied FDA label excerpts, list boxed/black-box warnings and contraindications that appear " +
      "in the label but are ABSENT from the promotional asset. Only list items the label actually " +
      "contains — do not invent warnings. If the label excerpts don't include a boxed warning or " +
      "contraindications section, return empty lists and say so.",
    user: `FDA LABEL EXCERPTS:\n${labelBlock}\n\nPROMOTIONAL ASSET:\n"""\n${assetText}\n"""\n\nList omissions.`,
  });
}
