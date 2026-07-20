"use client";

import { useMemo } from "react";
import type { Claim } from "@/lib/schemas";
import { anchorClaims, type Anchor } from "../review-model";
import type { Finding } from "@/lib/schemas";

/**
 * The asset under review, rendered as a sheet of paper with each claim marked
 * in place.
 *
 * This is the pane the old UI was missing: MLR review happens *on* a document,
 * and a findings list detached from the text it describes forces the reviewer
 * to hold the mapping in their head. Each claim gets a number; the number —
 * not the colour — is what ties a mark to its finding.
 */
export function AssetSheet({
  assetName,
  assetText,
  claims,
  findingsByClaim,
  activeClaimId,
  onSelectClaim,
}: {
  assetName: string;
  assetText: string;
  claims: Claim[];
  findingsByClaim: Map<string, Finding[]>;
  activeClaimId: string | null;
  onSelectClaim: (claimId: string | null) => void;
}) {
  const { anchors, unanchored } = useMemo(
    () => anchorClaims(assetText, claims, findingsByClaim),
    [assetText, claims, findingsByClaim],
  );

  return (
    <div className="sheet">
      <div className="sheet-head">
        <span className="nm" title={assetName}>
          {assetName || "Untitled asset"}
        </span>
        <span className="hint" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
          {anchors.length} of {claims.length} claims marked
        </span>
      </div>

      <div className="sheet-body">
        <MarkedText text={assetText} anchors={anchors} activeClaimId={activeClaimId} onSelect={onSelectClaim} />

        {unanchored.length > 0 && (
          <p className="hint" style={{ marginTop: 20, fontFamily: "var(--font-sans)" }}>
            {unanchored.length} claim{unanchored.length === 1 ? "" : "s"} could not be located in the
            text verbatim and {unanchored.length === 1 ? "is" : "are"} unmarked — see the findings
            list.
          </p>
        )}
      </div>
    </div>
  );
}

/** Walk the asset once, emitting plain text and marked spans in document order. */
function MarkedText({
  text,
  anchors,
  activeClaimId,
  onSelect,
}: {
  text: string;
  anchors: Anchor[];
  activeClaimId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const out: React.ReactNode[] = [];
  let cursor = 0;

  for (const a of anchors) {
    if (a.start > cursor) out.push(text.slice(cursor, a.start));
    const isActive = activeClaimId === a.claim.id;
    // A <span>, not a <button>: form controls are atomic inline-level boxes, so
    // a long marked claim would be bumped whole onto its own line instead of
    // starting mid-sentence and wrapping like the prose around it.
    out.push(
      <span
        key={a.claim.id}
        id={`mark-${a.claim.id}`}
        className={`mk ${a.severity}`}
        role="button"
        tabIndex={0}
        aria-current={isActive}
        aria-label={`Claim ${a.index}, ${a.severity}: ${a.claim.text}`}
        onClick={() => onSelect(isActive ? null : a.claim.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(isActive ? null : a.claim.id);
          }
        }}
      >
        {text.slice(a.start, a.end)}
        <span className="n" aria-hidden="true">
          {a.index}
        </span>
      </span>,
    );
    cursor = a.end;
  }
  if (cursor < text.length) out.push(text.slice(cursor));

  return <>{out}</>;
}
