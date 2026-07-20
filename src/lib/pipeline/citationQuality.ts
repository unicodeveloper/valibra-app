import type { Claim, Evidence, Finding } from "../schemas";

/**
 * F4 — Citation currency & quality gate. Pure, deterministic: no LLM, no extra
 * retrieval. Flags weak substantiation — a claim whose supporting evidence is a
 * PREPRINT (can't substantiate promo), stale, or uncited.
 */
const PREPRINT_HINTS = ["biorxiv", "medrxiv", "chemrxiv", "arxiv"];
const STALE_YEARS = 10;

function year(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const m = /\d{4}/.exec(dateStr);
  return m ? Number(m[0]) : null;
}

export function checkCitationQuality(claims: Claim[], evidenceByClaim: Record<string, Evidence[]>): Finding[] {
  const findings: Finding[] = [];
  const nowYear = new Date().getFullYear();

  for (const claim of claims) {
    const evidence = evidenceByClaim[claim.id] ?? [];
    if (evidence.length === 0) continue;

    const issues: string[] = [];
    const preprints = evidence.filter((e) =>
      PREPRINT_HINTS.some((h) => e.source.toLowerCase().includes(h)),
    );
    if (preprints.length) {
      issues.push(
        `${preprints.length} supporting item(s) are preprints (not peer-reviewed) and cannot substantiate a promotional claim.`,
      );
    }
    const years = evidence.map((e) => year(e.publicationDate)).filter((y): y is number => y != null);
    if (years.length && Math.max(...years) < nowYear - STALE_YEARS) {
      issues.push(`Newest supporting reference is from ${Math.max(...years)} — potentially outdated.`);
    }

    if (issues.length) {
      findings.push({
        id: `cite-${claim.id}`,
        category: "citation-quality",
        severity: "warning",
        claimId: claim.id,
        claimText: claim.text,
        headline: "Weak citation quality",
        detail: issues.map((i) => `- ${i}`).join("\n"),
        confidence: null,
        evidence: preprints,
      });
    }
  }
  return findings;
}
