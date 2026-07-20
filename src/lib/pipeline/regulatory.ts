import { structured } from "../llm";
import * as valyu from "../valyu";
import { RegulatoryGroundingSchema, type Evidence, type RegulatoryGrounding } from "../schemas";

/**
 * F9 — Regulatory grounding + enforcement precedent. Ties the review's concerns
 * to specific FDA promotional guidance and OPDP warning/untitled-letter
 * precedent. This is the feature ERMA sells as its moat — and it's buildable
 * from public, retrievable web content, so it reaches day-one parity.
 */
export async function groundRegulatory(
  drugName: string,
  concerns: string[],
  markets: string[] = ["US"],
): Promise<{ result: RegulatoryGrounding; evidence: Evidence[]; error: string | null }> {
  if (concerns.length === 0) {
    return {
      result: { groundings: [], rationale: "No flagged concerns to ground." },
      evidence: [],
      error: null,
    };
  }

  const nonUs = markets.filter((m) => m !== "US");
  // US: OPDP enforcement precedent + FDA guidance (public web). F14: add UK/EU.
  const query =
    `Actual FDA OPDP (Office of Prescription Drug Promotion) warning letters and untitled letters, ` +
    `and FDA promotional-advertising guidance, that address: ${concerns.join("; ")}` +
    (nonUs.length ? ` — also ${nonUs.join("/")} (EMA/MHRA/ABPI) promotional rules` : "") +
    (drugName ? ` (drug/class context: ${drugName})` : "");
  const [us, uk] = await Promise.all([
    valyu.searchRegulatory(query),
    nonUs.length
      ? valyu.searchUkRegulatory(`UK/EU pharmaceutical promotion rules for: ${concerns.join("; ")}`)
      : Promise.resolve({ evidence: [], error: null }),
  ]);
  const evidence = [...us.evidence, ...uk.evidence];
  const error = us.error || uk.error;
  if (error) {
    return {
      result: {
        groundings: [],
        rationale: `Could not retrieve enforcement precedent: ${error}`,
      },
      evidence: [],
      error,
    };
  }

  const evBlock = evidence
    .map((e, i) => `[${i + 1}] ${e.title}\n${e.url}\n${e.snippet}`)
    .join("\n\n---\n\n");

  const result = await structured(RegulatoryGroundingSchema, {
    name: "regulatory_grounding",
    system:
      "You ground MLR review concerns in FDA promotional regulation. Using ONLY the supplied web " +
      "results, tie each concern to a specific enforcement precedent (an OPDP warning or untitled " +
      "letter) or an FDA promotional-advertising guidance document, citing the source URL. " +
      "IMPORTANT: a drug label / prescribing information (e.g. DailyMed) is NOT enforcement " +
      "precedent — do NOT cite one as the grounding. If a concern has no matching OPDP letter or " +
      "FDA guidance in the results, OMIT it rather than grounding it against a label or inventing a " +
      "citation. Never fabricate a letter.",
    user: `REVIEW CONCERNS:\n${concerns.map((c) => `- ${c}`).join("\n")}\n\nRETRIEVED GUIDANCE / PRECEDENT:\n${evBlock}\n\nGround each concern.`,
  });

  return { result, evidence, error: null };
}
