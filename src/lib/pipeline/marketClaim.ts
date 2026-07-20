import { structured } from "../llm";
import * as valyu from "../valyu";
import { MarketClaimSchema, type Claim, type Evidence, type MarketClaim } from "../schemas";

const MARKET_RE =
  /#\s*1|number one|#1|most prescribed|best[- ]selling|market[- ]lead|market share|top[- ]selling|leading (brand|therapy|treatment)|most (used|prescribed|trusted)/i;

/** Claims that assert a market position / share / sales rank. */
export function marketClaims(claims: Claim[]): Claim[] {
  return claims.filter((c) => MARKET_RE.test(c.text) || c.type === "economic");
}

/**
 * F12 — Market-claim checker. "#1 prescribed" / market-share / sales-rank claims
 * checked against SEC filings and public web data.
 */
export async function checkMarketClaims(
  claims: Claim[],
  drugName: string,
): Promise<{ result: MarketClaim; error: string | null }> {
  if (claims.length === 0) {
    return { result: { findings: [], rationale: "No market-position claims." }, error: null };
  }
  const { evidence, error } = await valyu.getMarketEvidence(
    `${drugName} market share, prescriptions, sales rank, competitive position ${claims
      .map((c) => c.text)
      .join("; ")}`,
  );
  if (evidence.length === 0) {
    return {
      result: {
        findings: claims.map((c) => ({
          claimId: c.id,
          verdict: "no_evidence" as const,
          why: "No market/financial evidence retrieved to substantiate the claim.",
        })),
        rationale: error ? `Retrieval failed: ${error}` : "No market evidence found.",
      },
      error,
    };
  }
  const evBlock = evidence
    .map((e: Evidence, i: number) => `[${i + 1}] ${e.title} (${e.source})\n${e.snippet}`)
    .join("\n\n---\n\n");
  const claimsBlock = claims.map((c) => `${c.id}: "${c.text}"`).join("\n");

  const result = await structured(MarketClaimSchema, {
    name: "market_claim",
    system:
      "You assess market-position claims ('#1 prescribed', 'market-leading', share/sales rank) in " +
      "pharmaceutical promotion. Using ONLY the supplied SEC-filing and web evidence, decide for " +
      "each claim whether it is 'supported', 'unsupported', or 'no_evidence'. Market-superiority " +
      "claims need specific, current, verifiable data — be conservative. Do not use outside knowledge.",
    user: `MARKET CLAIMS:\n${claimsBlock}\n\nEVIDENCE:\n${evBlock}\n\nAssess each claim.`,
  });
  return { result, error };
}
