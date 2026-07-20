import type { Claim, Finding, ReviewResult, Severity } from "@/lib/schemas";

/**
 * View-model for the review workspace: the glue that lets the asset text and
 * the findings list address each other.
 */

export type Decision = "accepted" | "rejected" | null;

/** Severity, ordered by how much it should interrupt a reviewer. */
const SEV_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export const SEV_GLYPH: Record<Severity, string> = {
  critical: "▲", // triangle — shape, not just hue, carries severity
  warning: "●",
  info: "✓",
};

export const SEV_WORD: Record<Severity, string> = {
  critical: "Critical",
  warning: "To review",
  info: "Supported",
};

/** Worst severity wins when several findings hit the same claim. */
export function worstSeverity(findings: Finding[]): Severity | null {
  let out: Severity | null = null;
  for (const f of findings) {
    if (out === null || SEV_RANK[f.severity] < SEV_RANK[out]) out = f.severity;
  }
  return out;
}

/**
 * A claim resolved to its character span in the asset text.
 *
 * Claim text is extracted verbatim, so an exact indexOf hits in practice. It is
 * still only a *convention*, not a guarantee — the LLM can normalise whitespace
 * or smart quotes. So we fall back to a whitespace/punctuation-insensitive scan
 * before giving up, and a claim that cannot be located is simply not marked in
 * the document rather than mis-marked.
 */
export interface Anchor {
  claim: Claim;
  index: number;
  start: number;
  end: number;
  severity: Severity;
}

/** Normalise the characters an LLM tends to swap, preserving length mapping. */
function canon(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/ /g, " ");
}

/**
 * Locate `needle` in `hay` tolerating differences in whitespace runs. Returns
 * [start, end) in `hay` coordinates, or null.
 */
function fuzzyFind(hay: string, needle: string, from: number): [number, number] | null {
  const h = canon(hay);
  const n = canon(needle).trim();
  if (!n) return null;

  const exact = h.indexOf(n, from);
  if (exact !== -1) return [exact, exact + n.length];

  // Whitespace-insensitive: walk `hay`, matching non-space chars of `needle`.
  const nc = n.replace(/\s+/g, "");
  if (!nc) return null;
  for (let start = from; start < h.length; start++) {
    if (h[start].trim() === "" ) continue;
    let hi = start;
    let ni = 0;
    while (hi < h.length && ni < nc.length) {
      const ch = h[hi];
      if (ch.trim() === "") { hi++; continue; }
      if (ch !== nc[ni]) break;
      hi++; ni++;
    }
    if (ni === nc.length) return [start, hi];
  }
  return null;
}

/**
 * Resolve every claim to a span in the asset, numbered in document order.
 * Overlapping claims are dropped (first wins) so rendering stays a flat walk.
 */
export function anchorClaims(
  assetText: string,
  claims: Claim[],
  findingsByClaim: Map<string, Finding[]>,
): { anchors: Anchor[]; unanchored: Claim[] } {
  const found: Omit<Anchor, "index">[] = [];
  const unanchored: Claim[] = [];

  for (const claim of claims) {
    const hit = fuzzyFind(assetText, claim.text, 0);
    if (!hit) {
      unanchored.push(claim);
      continue;
    }
    const sev = worstSeverity(findingsByClaim.get(claim.id) ?? []) ?? "info";
    found.push({ claim, start: hit[0], end: hit[1], severity: sev });
  }

  found.sort((a, b) => a.start - b.start);

  const anchors: Anchor[] = [];
  let cursor = -1;
  for (const a of found) {
    if (a.start < cursor) {
      unanchored.push(a.claim); // overlaps something already marked
      continue;
    }
    anchors.push({ ...a, index: anchors.length + 1 });
    cursor = a.end;
  }
  return { anchors, unanchored };
}

/** Findings grouped by the claim they concern (asset-level findings excluded). */
export function groupByClaim(findings: Finding[]): Map<string, Finding[]> {
  const m = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!f.claimId) continue;
    const arr = m.get(f.claimId);
    if (arr) arr.push(f);
    else m.set(f.claimId, [f]);
  }
  return m;
}

export interface Counts {
  critical: number;
  warning: number;
  info: number;
}

export function countBySeverity(findings: Finding[]): Counts {
  return {
    critical: findings.filter((f) => f.severity === "critical").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
  };
}

/**
 * Did this review actually check anything?
 *
 * When retrieval fails wholesale (no credits, bad key, network) the pipeline
 * still returns a full-looking result: every claim gets a `no_evidence`
 * verification and a finding. Rendering that identically to a real review is
 * the single most dangerous thing this UI could do — it invites sign-off on an
 * asset nothing was checked against. Detect it and say so.
 */
export function isUnchecked(r: ReviewResult): boolean {
  return r.provenance.sourceCount === 0 && r.retrievalErrors.length > 0;
}

/** A short, human name for a Valyu dataset id. */
export function datasetLabel(id: string): string {
  const tail = id.split("/").pop() ?? id;
  return tail.replace(/^valyu-/, "").replace(/-/g, " ");
}

/** Year from an ISO-ish date, for dating evidence at a glance. */
export function yearOf(d: string | null): string | null {
  if (!d) return null;
  const m = /(\d{4})/.exec(d);
  return m ? m[1] : null;
}

export const CATEGORY_LABEL: Record<string, string> = {
  substantiation: "substantiation",
  "fair-balance": "fair balance",
  "off-label": "off-label",
  "citation-quality": "citation",
  "adverse-event": "adverse event",
  "safety-omission": "safety omission",
  "drug-interaction": "interaction",
  regulatory: "precedent",
  comparative: "comparative",
  ip: "novelty / IP",
  "market-claim": "market claim",
  mechanism: "mechanism",
  epidemiology: "epidemiology",
  biomarker: "biomarker",
  surveillance: "surveillance",
};
