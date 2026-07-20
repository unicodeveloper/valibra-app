import { structured } from "../llm";
import { VerificationSchema, type Claim, type Evidence, type Verification } from "../schemas";

/**
 * F3 — Reference verification (entailment). THE differentiator.
 * Given a claim and the evidence Valyu retrieved, decide whether the evidence
 * actually supports it. The model reasons over supplied evidence only — it never
 * introduces a citation. If nothing supports the claim, it must abstain
 * (verdict "no_evidence"), never bluff.
 */
export function verifyClaim(claim: Claim, evidence: Evidence[]): Promise<Verification> {
  if (evidence.length === 0) {
    return Promise.resolve({
      verdict: "no_evidence",
      confidence: 1,
      rationale: "No supporting source was retrieved for this claim.",
      citedPassage: "",
      citedSourceUrl: "",
    });
  }

  const evidenceBlock = evidence
    .map(
      (e, i) =>
        `[${i + 1}] ${e.title} (${e.source})\nURL: ${e.url}\n${e.snippet}`,
    )
    .join("\n\n---\n\n");

  return structured(VerificationSchema, {
    name: "verification",
    system:
      "You verify whether retrieved biomedical evidence substantiates a promotional claim. " +
      "Rules you must not break: (1) Judge ONLY against the evidence provided below — never use " +
      "outside knowledge to fill gaps. (2) If the evidence directly conflicts with the claim, " +
      "return 'contradicted'. (3) Cite the exact passage that decides your verdict. (4) Give a " +
      "calibrated confidence in [0,1].\n" +
      "How to weigh support:\n" +
      "- QUALITATIVE effect claims (e.g. 'improves glycemic control', 'lowers LDL', 'is indicated " +
      "for X') → 'supported' if the evidence establishes that effect/indication for the drug OR " +
      "its drug class, even without identical wording. The specific brand name need not appear in " +
      "the evidence — judge the underlying clinical assertion.\n" +
      "- QUANTITATIVE claims (a specific magnitude like 'up to 55%') and COMPARATIVE/superiority " +
      "claims ('more effective than <named drug>') → require evidence that specifically " +
      "substantiates that magnitude or head-to-head comparison. If absent, return 'no_evidence'; " +
      "if the evidence points the other way, 'unsupported' or 'contradicted'.\n" +
      "- If the evidence is silent on the claim's substance, return 'no_evidence' — do NOT bluff.",
    user:
      `CLAIM (${claim.type}): "${claim.text}"\n\n` +
      `RETRIEVED EVIDENCE:\n${evidenceBlock}\n\n` +
      "Return your entailment verdict.",
  });
}
