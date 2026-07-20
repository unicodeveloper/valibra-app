"use client";

import { Streamdown } from "streamdown";
import remarkGfm from "remark-gfm";
import type { Finding } from "@/lib/schemas";
import {
  CATEGORY_LABEL,
  SEV_GLYPH,
  SEV_WORD,
  datasetLabel,
  yearOf,
  type Decision,
} from "../review-model";

export function FindingCard({
  finding,
  claimIndex,
  decision,
  open,
  active,
  unchecked,
  onToggle,
  onDecide,
  onFocusClaim,
}: {
  finding: Finding;
  claimIndex: number | null;
  decision: Decision;
  open: boolean;
  active: boolean;
  unchecked: boolean;
  onToggle: () => void;
  onDecide: (d: Decision) => void;
  onFocusClaim: () => void;
}) {
  const sev = finding.severity;
  const conf = finding.confidence;

  return (
    <article
      className="finding"
      id={`finding-${finding.id}`}
      data-open={open}
      data-active={active}
      data-decided={decision !== null}
      /* drives the severity rail and title weight; an unchecked finding must
         not borrow the authority of one that was actually verified */
      data-sev={unchecked ? "muted" : sev}
    >
      <button className="f-top" onClick={onToggle} aria-expanded={open} aria-controls={`fb-${finding.id}`}>
        <span className={`sev ${unchecked ? "muted" : sev}`} aria-hidden="true">
          {unchecked ? "?" : SEV_GLYPH[sev]}
        </span>

        <span className="f-mid">
          <h3 className="f-title">{finding.headline}</h3>
          <span className="f-meta">
            <span className="tag">{CATEGORY_LABEL[finding.category] ?? finding.category}</span>

            {claimIndex !== null && (
              <span className="tag claim-ref">claim {claimIndex}</span>
            )}

            <span className="hint" style={{ fontSize: 11 }}>
              {unchecked ? "not checked" : SEV_WORD[sev]}
            </span>

            {conf != null && !unchecked && (
              <span className="conf" title={`Model confidence in this verdict: ${Math.round(conf * 100)}%`}>
                <span className="conf-track">
                  <span className="conf-fill" style={{ width: `${Math.round(conf * 100)}%` }} />
                </span>
                {Math.round(conf * 100)}%
              </span>
            )}

            {finding.libraryMatch && (
              <span
                className="tag lib"
                title={
                  finding.libraryMatch.matchedText
                    ? `Matched “${finding.libraryMatch.matchedText}” (saved ${finding.libraryMatch.savedAt.slice(0, 10)})`
                    : `Saved ${finding.libraryMatch.savedAt.slice(0, 10)}`
                }
              >
                ✓ library · {finding.libraryMatch.verdict}
                {finding.libraryMatch.similarity < 0.999
                  ? ` · ${Math.round(finding.libraryMatch.similarity * 100)}%`
                  : ""}
              </span>
            )}

            {decision && <span className={`tag dec-${decision}`}>{decision}</span>}
          </span>
        </span>

        <span className="f-caret" aria-hidden="true">
          ▸
        </span>
      </button>

      {open && (
        <div className="f-body" id={`fb-${finding.id}`}>
          {finding.claimText && (
            <blockquote className="quote">
              {claimIndex !== null ? (
                <button className="quote-jump" onClick={onFocusClaim} title="Show this claim in the asset">
                  “{finding.claimText}”
                </button>
              ) : (
                <>“{finding.claimText}”</>
              )}
            </blockquote>
          )}

          <div className="rationale">
            <Streamdown remarkPlugins={[remarkGfm]}>{finding.detail}</Streamdown>
          </div>

          {finding.evidence.length > 0 && (
            <details className="ev-toggle">
              <summary>
                {finding.evidence.length} source{finding.evidence.length === 1 ? "" : "s"}
              </summary>
              {finding.evidence.map((e, i) => {
                const yr = yearOf(e.publicationDate);
                return (
                  <div className="ev" key={`${e.url}-${i}`}>
                    <div className="ev-top">
                      <span className="ds">{datasetLabel(e.source)}</span>
                      {yr && <span className="yr">{yr}</span>}
                      {e.citationCount != null && e.citationCount > 0 && (
                        <span className="yr">· {e.citationCount.toLocaleString()} citations</span>
                      )}
                    </div>
                    {e.url ? (
                      <a href={e.url} target="_blank" rel="noreferrer">
                        {e.title}
                      </a>
                    ) : (
                      <span style={{ fontWeight: 600 }}>{e.title}</span>
                    )}
                    <p className="snip">
                      {e.snippet.length > 300 ? e.snippet.slice(0, 300).trimEnd() + "…" : e.snippet}
                    </p>
                  </div>
                );
              })}
            </details>
          )}

          <div className="decide">
            <button
              className={`sm ${decision === "accepted" ? "on-a" : "ghost"}`}
              onClick={() => onDecide(decision === "accepted" ? null : "accepted")}
              aria-pressed={decision === "accepted"}
            >
              Accept
            </button>
            <button
              className={`sm ${decision === "rejected" ? "on-r" : "ghost"}`}
              onClick={() => onDecide(decision === "rejected" ? null : "rejected")}
              aria-pressed={decision === "rejected"}
            >
              Reject
            </button>
            <span className="hint" style={{ marginLeft: "auto" }}>
              <kbd>A</kbd> accept · <kbd>R</kbd> reject
            </span>
          </div>
        </div>
      )}
    </article>
  );
}
