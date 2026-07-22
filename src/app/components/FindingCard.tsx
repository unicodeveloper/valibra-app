"use client";

import { useEffect, useState } from "react";
import { Markdown } from "./Markdown";
import type { Finding } from "@/lib/schemas";
import {
  CATEGORY_LABEL,
  SEV_GLYPH,
  SEV_WORD,
  datasetLabel,
  readableSnippet,
  yearOf,
  type Decision,
  type DecisionNote,
} from "../review-model";

/** What the /api/suggest-revision endpoint returns. */
export interface RevisionDraft {
  kind: "rewrite" | "instruction" | "abstain";
  text: string;
}

export function FindingCard({
  finding,
  claimIndex,
  decision,
  note,
  open,
  active,
  unchecked,
  onToggle,
  onDecide,
  onNote,
  onDraftRevision,
  onFocusClaim,
}: {
  finding: Finding;
  claimIndex: number | null;
  decision: Decision;
  note: DecisionNote;
  open: boolean;
  active: boolean;
  unchecked: boolean;
  onToggle: () => void;
  onDecide: (d: Decision) => void;
  onNote: (note: DecisionNote) => void;
  onDraftRevision: () => Promise<RevisionDraft | null>;
  onFocusClaim: () => void;
}) {
  const sev = finding.severity;
  const conf = finding.confidence;

  // Local mirrors of the note fields so typing is smooth; persisted to the
  // parent (and server) on blur, not per keystroke. Re-seeded when the note
  // changes underneath us — reopening a review, or an accepted AI draft.
  const [revision, setRevision] = useState(note.suggestedRevision ?? "");
  const [reason, setReason] = useState(note.rationale ?? "");
  const [draft, setDraft] = useState<RevisionDraft | null>(null);
  const [drafting, setDrafting] = useState(false);

  useEffect(() => setRevision(note.suggestedRevision ?? ""), [note.suggestedRevision]);
  useEffect(() => setReason(note.rationale ?? ""), [note.rationale]);

  const commit = (next: Partial<DecisionNote>) =>
    onNote({ rationale: reason, suggestedRevision: revision, ...next });

  // "Dirty" = the field has edits the reviewer hasn't saved yet. Saving happens
  // on blur and on Enter; the status line below each field tells the reviewer
  // which state they're in, so a typed reason never silently fails to record.
  const reasonDirty = reason !== (note.rationale ?? "");
  const revisionDirty = revision !== (note.suggestedRevision ?? "");
  const commitReason = () => {
    if (reasonDirty) commit({ rationale: reason });
  };
  const commitRevision = () => {
    if (revisionDirty) commit({ suggestedRevision: revision });
  };

  async function draftRevision() {
    setDrafting(true);
    try {
      setDraft(await onDraftRevision());
    } finally {
      setDrafting(false);
    }
  }

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
            <Markdown>{finding.detail}</Markdown>
          </div>

          {finding.evidence.length > 0 && (
            <details className="ev-toggle">
              <summary>
                {finding.evidence.length} source{finding.evidence.length === 1 ? "" : "s"}
              </summary>
              {finding.evidence.map((e, i) => {
                const yr = yearOf(e.publicationDate);
                const snip = readableSnippet(e.snippet);
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
                    {snip && (
                      <div className="snip">
                        <Markdown>
                          {snip.length > 300 ? snip.slice(0, 300).trimEnd() + "…" : snip}
                        </Markdown>
                      </div>
                    )}
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
              title="Approve this claim as written  ·  shortcut A"
            >
              Accept
            </button>
            <button
              className={`sm ${decision === "revision" ? "on-e" : "ghost"}`}
              onClick={() => onDecide(decision === "revision" ? null : "revision")}
              aria-pressed={decision === "revision"}
              title="Approve with changes — add a suggested revision for the content team  ·  shortcut E"
            >
              Request revision
            </button>
            <button
              className={`sm ${decision === "rejected" ? "on-r" : "ghost"}`}
              onClick={() => onDecide(decision === "rejected" ? null : "rejected")}
              aria-pressed={decision === "rejected"}
              title="Flag this claim to be removed — add the reason  ·  shortcut R"
            >
              Reject
            </button>
            <span className="hint" style={{ marginLeft: "auto" }}>
              <kbd>A</kbd> accept · <kbd>E</kbd> revise · <kbd>R</kbd> reject
            </span>
          </div>

          {/* Revision request: the proposed replacement copy + an optional
              reason. Draft is grounded and advisory — the reviewer owns the
              final text. */}
          {decision === "revision" && (
            <div className="annot">
              <div className="annot-head">
                <label htmlFor={`rev-${finding.id}`}>Suggested revision</label>
                <button className="quiet xs" onClick={draftRevision} disabled={drafting}>
                  {drafting ? "Drafting…" : "✦ Draft from evidence"}
                </button>
              </div>

              {draft && draft.kind !== "rewrite" && (
                <p className="annot-hint">
                  {draft.kind === "abstain" ? "No grounded rewrite: " : "Suggested fix: "}
                  {draft.text}
                </p>
              )}
              {draft && draft.kind === "rewrite" && revision !== draft.text && (
                <p className="annot-hint">
                  Suggested: “{draft.text}”{" "}
                  <button
                    className="link xs"
                    onClick={() => {
                      setRevision(draft.text);
                      commit({ suggestedRevision: draft.text });
                    }}
                  >
                    Use this
                  </button>
                </p>
              )}

              <div className="annot-field">
                <textarea
                  id={`rev-${finding.id}`}
                  className="annot-text"
                  value={revision}
                  onChange={(e) => setRevision(e.target.value)}
                  onBlur={commitRevision}
                  onKeyDown={(e) => {
                    // ⌘/Ctrl+Enter saves; plain Enter keeps adding lines.
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      commitRevision();
                    }
                  }}
                  placeholder="What should this claim say instead? (compliant, evidence-supported copy)"
                  rows={2}
                />
                <SaveStatus dirty={revisionDirty} filled={revision.trim() !== ""} enterHint="⌘↵" />
              </div>
              <div className="annot-field">
                <input
                  className="annot-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  onBlur={commitReason}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitReason();
                    }
                  }}
                  placeholder="Reason for the change (optional)"
                />
                <SaveStatus dirty={reasonDirty} filled={reason.trim() !== ""} enterHint="↵" />
              </div>
            </div>
          )}

          {decision === "rejected" && (
            <div className="annot">
              <div className="annot-field">
                <input
                  className="annot-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  onBlur={commitReason}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitReason();
                    }
                  }}
                  placeholder="Why is this claim rejected? (tells the content team what to remove and why)"
                />
                <SaveStatus dirty={reasonDirty} filled={reason.trim() !== ""} enterHint="↵" />
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** Tells the reviewer whether a note field's text is saved or has pending edits,
 *  so a typed reason never silently fails to record. Hidden when the field is
 *  empty (nothing to save). */
function SaveStatus({
  dirty,
  filled,
  enterHint,
}: {
  dirty: boolean;
  filled: boolean;
  enterHint: string;
}) {
  if (!filled) return null;
  return (
    <span className={`annot-status ${dirty ? "dirty" : "saved"}`} aria-live="polite">
      {dirty ? `${enterHint} to save` : "✓ Saved"}
    </span>
  );
}
