import { structured } from "../llm";
import * as valyu from "../valyu";
import { RegulatoryGroundingSchema, type Evidence, type RegulatoryGrounding } from "../schemas";
import { searchPrecedent } from "../precedent";

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
  const [us, uk, seeded] = await Promise.all([
    valyu.searchRegulatory(query),
    nonUs.length
      ? valyu.searchUkRegulatory(`UK/EU pharmaceutical promotion rules for: ${concerns.join("; ")}`)
      : Promise.resolve({ evidence: [], error: null }),
    // This year's OPDP letters, shipped with the app. Placed FIRST because a web
    // search returns a snippet of a letter while these carry its full findings
    // text — and because they are dated, so a reviewer can judge currency. The
    // live search still runs: it is what covers letters issued since the seeded
    // corpus was last refreshed.
    searchPrecedent(concerns),
  ]);
  const evidence = [...seeded, ...us.evidence, ...uk.evidence];
  // A retrieval failure is only fatal when it leaves nothing to ground against.
  // With seeded precedent present, the review still gets real letters.
  const error = us.error || uk.error;
  if (error && seeded.length === 0) {
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
      "Sources titled 'OPDP untitled letter' are the full text of real letters issued this year, " +
      "shipped with this tool; they carry an issue date, and FDA's positions shift over time, so " +
      "cite the date alongside the finding. " +
      "IMPORTANT: a drug label / prescribing information (e.g. DailyMed) is NOT enforcement " +
      "precedent — do NOT cite one as the grounding. If a concern has no matching OPDP letter or " +
      "FDA guidance in the results, OMIT it rather than grounding it against a label or inventing a " +
      "citation. Never fabricate a letter.",
    user: `REVIEW CONCERNS:\n${concerns.map((c) => `- ${c}`).join("\n")}\n\nRETRIEVED GUIDANCE / PRECEDENT:\n${evBlock}\n\nGround each concern.`,
  });

  return { result, evidence, error: null };
}
