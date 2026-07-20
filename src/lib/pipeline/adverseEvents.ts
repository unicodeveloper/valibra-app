import { structured } from "../llm";
import { AdverseEventCheckSchema, type AdverseEventCheck, type Claim, type Evidence } from "../schemas";

/**
 * F7 — Adverse-event contradiction check. Cross-references tolerability/safety
 * claims ("well tolerated", "minimal side effects") against real FAERS
 * post-market signals. Uniquely ours — no competitor wires in adverse-event data.
 */
export function checkAdverseEvents(
  safetyClaims: Claim[],
  faers: Evidence[],
): Promise<AdverseEventCheck> {
  if (safetyClaims.length === 0 || faers.length === 0) {
    return Promise.resolve({
      consistent: true,
      contradictions: [],
      rationale:
        faers.length === 0
          ? "No FAERS adverse-event data retrieved."
          : "No safety/tolerability claims to cross-check.",
    });
  }

  const faersBlock = faers.map((e, i) => `[${i + 1}] ${e.title}\n${e.snippet}`).join("\n\n---\n\n");
  const claimsBlock = safetyClaims.map((c) => `${c.id}: "${c.text}"`).join("\n");

  return structured(AdverseEventCheckSchema, {
    name: "adverse_events",
    system:
      "You cross-check pharmaceutical safety/tolerability claims against real post-market adverse-" +
      "event reports (FAERS). Using ONLY the supplied FAERS excerpts, flag any claim (e.g. 'well " +
      "tolerated', 'minimal side effects') that is contradicted or undercut by reported serious " +
      "adverse events. Reference the specific signal. Do not use outside knowledge; if FAERS is " +
      "silent, treat the claim as not contradicted.",
    user: `FAERS ADVERSE-EVENT REPORTS:\n${faersBlock}\n\nSAFETY CLAIMS:\n${claimsBlock}\n\nCross-check.`,
  });
}
