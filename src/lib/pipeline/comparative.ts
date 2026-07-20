import { structured } from "../llm";
import * as valyu from "../valyu";
import { ComparativeCheckSchema, type Claim, type ComparativeCheck, type Evidence } from "../schemas";

/**
 * F10 — Comparative / superiority checker. A superiority claim ("more effective
 * than X") requires DIRECT head-to-head evidence. Retrieves head-to-head trials
 * and flags claims backed only by indirect comparison or nothing.
 */
export async function checkComparative(
  comparativeClaims: Claim[],
  drugName: string,
): Promise<{ result: ComparativeCheck; error: string | null }> {
  if (comparativeClaims.length === 0) {
    return { result: { findings: [], rationale: "No comparative claims." }, error: null };
  }

  // Retrieve head-to-head evidence per claim (comparator is embedded in the query).
  const retrievals = await Promise.all(
    comparativeClaims.map((c) => valyu.getHeadToHead(drugName, c.searchQuery || c.text)),
  );
  const error = retrievals.find((r) => r.error)?.error ?? null;
  const seen = new Set<string>();
  const evidence: Evidence[] = [];
  for (const e of retrievals.flatMap((r) => r.evidence)) {
    const k = e.url || e.title;
    if (seen.has(k)) continue;
    seen.add(k);
    evidence.push(e);
  }
  if (evidence.length === 0) {
    return {
      result: {
        findings: comparativeClaims.map((c) => ({
          claimId: c.id,
          comparator: "",
          verdict: "no_head_to_head" as const,
          why: "No head-to-head comparative evidence retrieved.",
        })),
        rationale: error ? `Retrieval failed: ${error}` : "No head-to-head evidence found.",
      },
      error,
    };
  }

  const evBlock = evidence.map((e, i) => `[${i + 1}] ${e.title} (${e.source})\n${e.snippet}`).join("\n\n---\n\n");
  const claimsBlock = comparativeClaims.map((c) => `${c.id}: "${c.text}"`).join("\n");

  const result = await structured(ComparativeCheckSchema, {
    name: "comparative",
    system:
      "You assess comparative/superiority claims in pharmaceutical promotion. A superiority claim " +
      "over a named comparator requires DIRECT head-to-head trial evidence. Using ONLY the supplied " +
      "evidence: for each claim, name the comparator and decide — 'head_to_head_supported' (a direct " +
      "trial supports it), 'indirect_only' (only indirect/cross-study comparison), 'no_head_to_head' " +
      "(no direct comparison found), or 'contradicted'. Do not use outside knowledge.",
    user: `COMPARATIVE CLAIMS:\n${claimsBlock}\n\nRETRIEVED EVIDENCE:\n${evBlock}\n\nAssess each claim.`,
  });
  return { result, error };
}
