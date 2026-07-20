import { structured } from "../llm";
import * as valyu from "../valyu";
import { IpCheckSchema, type Claim, type Evidence, type IpCheck } from "../schemas";

const NOVELTY_RE = /first[- ]in[- ]class|first[- ]and[- ]only|\bnovel\b|\bfirst\b|\bonly\b|breakthrough|patented|proprietary|innovativ/i;

/** Claims that make a novelty / first-in-class / IP assertion. */
export function noveltyClaims(claims: Claim[]): Claim[] {
  return claims.filter((c) => NOVELTY_RE.test(c.text));
}

/**
 * F11 — IP / first-in-class / novelty checker. Validates "first-in-class",
 * "novel", "only" style claims against the patent record (USPTO + EPO).
 */
export async function checkIp(
  claims: Claim[],
  drugName: string,
): Promise<{ result: IpCheck; error: string | null }> {
  if (claims.length === 0) {
    return { result: { findings: [], rationale: "No novelty/IP claims." }, error: null };
  }
  const { evidence, error } = await valyu.getPatents(
    `${drugName} ${claims.map((c) => c.searchQuery || c.text).join("; ")} first-in-class novel patent`,
  );
  if (evidence.length === 0) {
    return {
      result: {
        findings: claims.map((c) => ({
          claimId: c.id,
          verdict: "no_evidence" as const,
          why: "No patent evidence retrieved to substantiate the novelty/IP claim.",
        })),
        rationale: error ? `Retrieval failed: ${error}` : "No patent evidence found.",
      },
      error,
    };
  }
  const evBlock = evidence
    .map((e: Evidence, i: number) => `[${i + 1}] ${e.title} (${e.source})\n${e.snippet}`)
    .join("\n\n---\n\n");
  const claimsBlock = claims.map((c) => `${c.id}: "${c.text}"`).join("\n");

  const result = await structured(IpCheckSchema, {
    name: "ip_check",
    system:
      "You assess novelty / first-in-class / IP claims in pharmaceutical promotion against the " +
      "patent record. Using ONLY the supplied patent results, decide for each claim whether the " +
      "novelty/first-in-class/IP assertion is 'supported', 'unsupported', or 'no_evidence'. Note " +
      "that a patent existing does not prove 'first-in-class' — be conservative. Do not use outside knowledge.",
    user: `NOVELTY/IP CLAIMS:\n${claimsBlock}\n\nPATENT EVIDENCE:\n${evBlock}\n\nAssess each claim.`,
  });
  return { result, error };
}
