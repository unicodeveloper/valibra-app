"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuditEntry, Finding, ReviewResult, Severity } from "@/lib/schemas";
import { SAMPLE_ASSET } from "../sample-asset";
import { AssetSheet } from "../components/AssetSheet";
import { FindingCard } from "../components/FindingCard";
import { FindingsSkeleton, RunProgress, stageOf } from "../components/RunProgress";
import {
  SEV_GLYPH,
  anchorClaims,
  countBySeverity,
  groupByClaim,
  isUnchecked,
  datasetLabel,
  type Decision,
} from "../review-model";
import type { DrKind } from "../dr";
import { authorizedHeaders, handleAuthFailure } from "../stores/auth-store";

const MARKETS = ["US", "EU", "UK"] as const;
type Market = (typeof MARKETS)[number];

export function ReviewView({
  onGenerateDossier,
  onStartDr,
  reopened,
}: {
  onGenerateDossier: (drug: string) => void;
  onStartDr: (kind: DrKind, input: string) => void;
  /** A past review pulled from history, with the decisions already made on it. */
  reopened?: { result: ReviewResult; decisions: Record<string, Decision> } | null;
}) {
  const [assetName, setAssetName] = useState("Sample asset");
  const [assetText, setAssetText] = useState(SAMPLE_ASSET);
  const [markets, setMarkets] = useState<Market[]>(["US"]);

  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [doneStages, setDoneStages] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);

  // Triage state
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);
  const [sevFilter, setSevFilter] = useState<Set<Severity>>(new Set());
  const [undecidedOnly, setUndecidedOnly] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Decisions are written server-side per click. If that write fails (DB down,
  // offline) the local state still stands — losing the triage a reviewer just
  // did would be far worse than a stale row — but we say so rather than let
  // them believe it was saved.
  const [unsaved, setUnsaved] = useState(0);
  const [persistOff, setPersistOff] = useState(false);

  /** Load a review pulled from history, decisions and all. */
  useEffect(() => {
    if (!reopened) return;
    abortRef.current?.abort();
    setRunning(false);
    setError(null);
    setUnsaved(0);
    setResult(reopened.result);
    setAssetName(reopened.result.assetName);
    setAssetText(reopened.result.assetText ?? "");
    setDecisions(reopened.decisions);
    setActiveClaimId(null);
    setOpenIds(
      new Set(
        reopened.result.findings
          .filter((f) => f.severity === "critical" && !reopened.decisions[f.id])
          .map((f) => f.id),
      ),
    );
  }, [reopened]);

  function toggleMarket(m: Market) {
    setMarkets((prev) => {
      const next = prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m];
      // At least one market must stay selected: the run falls back to US
      // server-side, so an empty toolbar would misreport what actually ran.
      return next.length ? next : prev;
    });
  }

  const runReview = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setRunning(true);
    setStartedAt(Date.now());
    setDoneStages(new Set());
    setError(null);
    setResult(null);
    setDecisions({});
    setOpenIds(new Set());
    setActiveClaimId(null);
    setUnsaved(0);

    try {
      // In valyu mode this attaches the reviewer's token so the run bills their
      // credits; in self-hosted mode it's a no-op and the server pays.
      const headers = await authorizedHeaders({
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      });
      const res = await fetch("/api/review", {
        method: "POST",
        headers,
        body: JSON.stringify({ assetText, assetName, markets }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        // An expired/absent session reopens sign-in rather than showing a raw error.
        if (handleAuthFailure(res.status, data)) {
          setError("Please sign in with Valyu to run a review.");
          return;
        }
        throw new Error(data.error || `Review failed (${res.status}).`);
      }

      // Non-streaming fallback: any deploy that buffers the response still works.
      if (!res.headers.get("content-type")?.includes("text/event-stream")) {
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        finish(data as ReviewResult);
        return;
      }

      await consumeStream(res.body, {
        onStage: (entry) => {
          const id = stageOf(entry.step);
          if (id) setDoneStages((prev) => new Set(prev).add(id));
        },
        onDone: (r) => finish(r),
        onFail: (msg) => setError(msg),
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Review failed.");
    } finally {
      if (!ac.signal.aborted) setRunning(false);
    }

    function finish(r: ReviewResult) {
      setResult(r);
      // Open the criticals by default — they're what the reviewer is here for.
      setOpenIds(new Set(r.findings.filter((f) => f.severity === "critical").map((f) => f.id)));
    }
  }, [assetText, assetName, markets]);

  function cancel() {
    abortRef.current?.abort();
    setRunning(false);
  }

  /* ------------------------------- derived ------------------------------- */

  const findingsByClaim = useMemo(
    () => (result ? groupByClaim(result.findings) : new Map<string, Finding[]>()),
    [result],
  );

  // Claim id -> its number in the document, so a finding can name its mark.
  const claimIndex = useMemo(() => {
    if (!result) return new Map<string, number>();
    const { anchors } = anchorClaims(assetText, result.claims, findingsByClaim);
    return new Map(anchors.map((a) => [a.claim.id, a.index]));
  }, [result, assetText, findingsByClaim]);

  const unchecked = result ? isUnchecked(result) : false;
  const counts = result ? countBySeverity(result.findings) : null;

  const visible = useMemo(() => {
    if (!result) return [];
    return result.findings.filter((f) => {
      if (sevFilter.size && !sevFilter.has(f.severity)) return false;
      if (undecidedOnly && decisions[f.id]) return false;
      if (activeClaimId && f.claimId !== activeClaimId) return false;
      return true;
    });
  }, [result, sevFilter, undecidedOnly, decisions, activeClaimId]);

  const decidedCount = result ? result.findings.filter((f) => decisions[f.id]).length : 0;
  const total = result?.findings.length ?? 0;

  /* ------------------------------ interaction ---------------------------- */

  const selectClaim = useCallback((id: string | null) => {
    setActiveClaimId(id);
    if (!id) return;
    // Reveal the claim's findings and bring the first into view.
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-claim="${id}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, []);

  const focusClaim = useCallback((claimId: string) => {
    setActiveClaimId(claimId);
    const el = document.getElementById(`mark-${claimId}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.focus();
  }, []);

  /**
   * Apply a decision locally, then record it server-side. Optimistic on purpose:
   * triage is a keyboard-speed activity and must never wait on a round trip.
   */
  const decide = useCallback(
    (id: string, d: Decision) => {
      setDecisions((prev) => ({ ...prev, [id]: d }));

      const reviewId = result?.reviewId;
      if (!reviewId) return;
      void fetch(`/api/reviews/${reviewId}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Un-deciding is recorded as "cleared", not as an absence — the audit
        // trail should show the reviewer changed their mind.
        body: JSON.stringify({ findingId: id, decision: d ?? "cleared" }),
      })
        .then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error || `Save failed (${r.status}).`);
          if (data.persisted === false && data.reason === "persistence_disabled") setPersistOff(true);
        })
        .catch(() => setUnsaved((n) => n + 1));
    },
    [result],
  );

  // A / R decide whichever finding the pointer or keyboard is inside.
  useEffect(() => {
    if (!result) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "Escape") {
        setActiveClaimId(null);
        return;
      }
      const k = e.key.toLowerCase();
      if (k !== "a" && k !== "r") return;
      const card = t?.closest<HTMLElement>(".finding");
      if (!card) return;
      const id = card.id.replace(/^finding-/, "");
      e.preventDefault();
      // Route through decide() so a keyboard decision persists exactly like a
      // clicked one.
      const want: Decision = k === "a" ? "accepted" : "rejected";
      decide(id, decisions[id] === want ? null : want);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result, decide, decisions]);

  function exportReport() {
    if (!result) return;
    const payload = {
      ...result,
      decisions,
      exportedAt: new Date().toISOString(),
      decisionSummary: {
        decided: decidedCount,
        total,
        accepted: Object.values(decisions).filter((d) => d === "accepted").length,
        rejected: Object.values(decisions).filter((d) => d === "rejected").length,
      },
    };
    downloadJson(`mlr-review-${result.reviewId.slice(0, 8)}.json`, payload);
  }

  /* -------------------------------- render ------------------------------- */

  if (!result && !running) {
    return (
      <div className="wrap narrow">
        <Compose
          assetName={assetName}
          setAssetName={setAssetName}
          assetText={assetText}
          setAssetText={setAssetText}
          markets={markets}
          toggleMarket={toggleMarket}
          onRun={runReview}
          disabled={false}
          error={error}
        />
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="review-grid">
        {/* ------------------------------ document ------------------------ */}
        <div className="doc-pane">
          {result ? (
            <AssetSheet
              assetName={result.assetName || assetName}
              assetText={assetText}
              claims={result.claims}
              findingsByClaim={findingsByClaim}
              activeClaimId={activeClaimId}
              onSelectClaim={selectClaim}
            />
          ) : (
            <div className="sheet">
              <div className="sheet-head">
                <span className="nm">{assetName || "Untitled asset"}</span>
              </div>
              <div className="sheet-body">{assetText}</div>
            </div>
          )}

          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="ghost sm"
              onClick={() => {
                setResult(null);
                setError(null);
              }}
              disabled={running}
            >
              ← Edit asset
            </button>
            {activeClaimId && (
              <button className="quiet sm" onClick={() => setActiveClaimId(null)}>
                Clear claim filter · <kbd>Esc</kbd>
              </button>
            )}
          </div>
        </div>

        {/* ------------------------------ findings ------------------------ */}
        <div>
          {running && (
            <>
              <RunProgress doneStages={doneStages} startedAt={startedAt} />
              <div className="row" style={{ margin: "10px 0 14px" }}>
                <button className="ghost sm" onClick={cancel}>
                  Cancel
                </button>
              </div>
              <FindingsSkeleton />
            </>
          )}

          {error && !running && (
            <div className="banner crit" role="alert">
              <span aria-hidden="true">▲</span>
              <div>
                <p className="b-t">Review failed</p>
                <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 12.5 }}>{error}</p>
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="sm" onClick={runReview}>
                    Retry
                  </button>
                </div>
              </div>
            </div>
          )}

          {result && (
            <>
              {result.retrievalHalt && (
                <div className="banner crit" role="alert">
                  <span aria-hidden="true">▲</span>
                  <div>
                    <p className="b-t">Out of Valyu credits — this review is incomplete</p>
                    <p style={{ margin: "0 0 4px", color: "var(--ink-2)", fontSize: 12.5 }}>
                      Evidence retrieval stopped partway through, so the remaining searches were
                      skipped rather than run. Any <strong>&ldquo;no evidence&rdquo;</strong> verdict
                      below may simply be a claim that was never checked.{" "}
                      <strong>Top up the account and re-run before signing off.</strong>
                    </p>
                    <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 12.5 }}>
                      Valyu reported: {result.retrievalHalt}
                    </p>
                    <div className="row" style={{ marginTop: 10 }}>
                      <button className="sm" onClick={runReview}>
                        Re-run review
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {unchecked && !result.retrievalHalt && (
                <div className="banner crit" role="alert">
                  <span aria-hidden="true">▲</span>
                  <div>
                    <p className="b-t">Nothing was verified — do not sign off on this</p>
                    <p style={{ margin: "0 0 4px", color: "var(--ink-2)", fontSize: 12.5 }}>
                      Evidence retrieval failed for every claim, so this run has{" "}
                      <strong>zero sources behind it</strong>. The findings below are the pipeline
                      abstaining, not a clean result.
                    </p>
                    <ul>
                      {result.retrievalErrors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {!unchecked && result.retrievalErrors.length > 0 && (
                <div className="banner warn" role="status">
                  <span aria-hidden="true">●</span>
                  <div>
                    <p className="b-t">Evidence retrieval was partly degraded</p>
                    <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 12.5 }}>
                      Some checks ran with less evidence than usual.
                    </p>
                    <ul>
                      {result.retrievalErrors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {(persistOff || unsaved > 0) && (
                <div className="banner warn" role="status">
                  <span aria-hidden="true">●</span>
                  <div>
                    <p className="b-t">
                      {persistOff
                        ? "Persistence is off — decisions live in this tab only"
                        : `${unsaved} decision${unsaved === 1 ? "" : "s"} couldn't be saved`}
                    </p>
                    <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 12.5 }}>
                      {persistOff ? (
                        <>
                          Set <code>DATABASE_URL</code> to keep the decision trail and reopen this
                          review later. Export the report to keep a record in the meantime.
                        </>
                      ) : (
                        <>
                          Your decisions are intact here, but the server didn&apos;t record them.
                          Export the report before closing this tab.
                        </>
                      )}
                    </p>
                  </div>
                </div>
              )}

              <Verdict
                result={result}
                counts={counts!}
                unchecked={unchecked}
                decided={decidedCount}
                total={total}
                sevFilter={sevFilter}
                setSevFilter={setSevFilter}
                undecidedOnly={undecidedOnly}
                setUndecidedOnly={setUndecidedOnly}
                onGenerateDossier={onGenerateDossier}
              />

              {!unchecked && result.provenance.sourceCount > 0 && (
                <div className="trust">
                  <span className="tb">
                    <span aria-hidden="true">✓</span> Licensed evidence
                  </span>
                  <span>
                    {result.provenance.sourceCount} sources across {result.provenance.datasets.length}{" "}
                    datasets · {result.provenance.markets.join(" / ")}
                  </span>
                  {result.provenance.datasets.map((d) => (
                    <span className="ds" key={d}>
                      {datasetLabel(d)}
                    </span>
                  ))}
                </div>
              )}

              {result.deepResearchRequired.length > 0 && (
                <div className="drreq">
                  <p className="b-t" style={{ margin: "0 0 2px", fontSize: 13 }}>
                    Requires deep research
                  </p>
                  <p className="hint" style={{ marginBottom: 6 }}>
                    These checks can only be answered by a DeepResearch-only dataset. They run async —
                    you&apos;ll be notified when the report lands.
                  </p>
                  {result.deepResearchRequired.map((d, i) => (
                    <div className="drreq-row" key={i}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 650 }}>{d.feature}</div>
                        <div className="hint">“{d.input}”</div>
                      </div>
                      <button className="sm ghost" onClick={() => onStartDr(d.kind, d.input)}>
                        Run deep research →
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="f-head">
                <span className="ttl">
                  {activeClaimId
                    ? `Findings for claim ${claimIndex.get(activeClaimId) ?? "?"}`
                    : "Findings"}
                  {visible.length !== total ? ` · ${visible.length} of ${total}` : ` · ${total}`}
                </span>
              </div>

              {visible.length === 0 ? (
                <div className="empty">
                  <div className="ico" aria-hidden="true">
                    ⌕
                  </div>
                  <h3>Nothing matches these filters</h3>
                  <p>
                    {undecidedOnly && decidedCount === total && total > 0
                      ? "Every finding has a decision. Export the annotated report to finish."
                      : "Clear a filter to see the rest of the findings."}
                  </p>
                </div>
              ) : (
                visible.map((f) => (
                  <div key={f.id} data-claim={f.claimId ?? undefined}>
                    <FindingCard
                      finding={f}
                      claimIndex={f.claimId ? claimIndex.get(f.claimId) ?? null : null}
                      decision={decisions[f.id] ?? null}
                      open={openIds.has(f.id)}
                      active={Boolean(activeClaimId && f.claimId === activeClaimId)}
                      unchecked={unchecked}
                      onToggle={() =>
                        setOpenIds((prev) => {
                          const n = new Set(prev);
                          if (n.has(f.id)) n.delete(f.id);
                          else n.add(f.id);
                          return n;
                        })
                      }
                      onDecide={(d) => decide(f.id, d)}
                      onFocusClaim={() => f.claimId && focusClaim(f.claimId)}
                    />
                  </div>
                ))
              )}

              <details className="panel" style={{ marginTop: 18 }}>
                <summary
                  style={{
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.09em",
                    textTransform: "uppercase",
                    color: "var(--ink-3)",
                  }}
                >
                  Audit trail · {result.audit.length} steps
                </summary>
                <div className="audit" style={{ marginTop: 12 }}>
                  {result.audit.map((a, i) => (
                    <div className="audit-row" key={i}>
                      <span className="t">{a.ts.slice(11, 19)}</span>
                      <span className="s">{a.step}</span>
                      <span className="d">{a.detail}</span>
                    </div>
                  ))}
                </div>
              </details>

              <div className="row" style={{ marginTop: 14 }}>
                <button className="ghost sm" onClick={exportReport}>
                  ↓ Export annotated report (JSON)
                </button>
                <button className="quiet sm" onClick={() => window.print()}>
                  Print / PDF
                </button>
                <span className="hint" style={{ marginLeft: "auto" }}>
                  Decision support — not an autonomous regulatory determination.
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- compose -------------------------------- */

function Compose({
  assetName,
  setAssetName,
  assetText,
  setAssetText,
  markets,
  toggleMarket,
  onRun,
  disabled,
  error,
}: {
  assetName: string;
  setAssetName: (s: string) => void;
  assetText: string;
  setAssetText: (s: string) => void;
  markets: Market[];
  toggleMarket: (m: Market) => void;
  onRun: () => void;
  disabled: boolean;
  error: string | null;
}) {
  return (
    <div className="compose">
      {/* A tool header, not a splash: it names the screen and states in one line
          what a run does, then gets out of the way of the form. The passes list
          below is the reference for what "checked" means. */}
      <header className="compose-head">
        <p className="compose-eyebrow">New review</p>
        <h2>Check every claim against the evidence</h2>
        <p className="compose-lede">
          Valibra extracts each promotional claim and tests it against approved labelling, trial
          records and the peer-reviewed literature. Every finding cites its source, for you to
          accept or reject.
        </p>
      </header>

      <div className="panel compose-form">
        <div className="field">
          <label htmlFor="asset-name">Asset name</label>
          <input
            id="asset-name"
            type="text"
            value={assetName}
            onChange={(e) => setAssetName(e.target.value)}
            placeholder="e.g. Q3 HCP detail aid"
          />
        </div>

        <div className="field">
          <label htmlFor="asset-text">Promotional asset text</label>
          <textarea
            id="asset-text"
            value={assetText}
            onChange={(e) => setAssetText(e.target.value)}
            placeholder="Paste the promotional copy to review…"
            spellCheck={false}
          />
        </div>

        <div className="compose-actions">
          <div className="row">
            <button onClick={onRun} disabled={disabled || !assetText.trim()}>
              Run review
            </button>
            <button className="ghost" onClick={() => setAssetText(SAMPLE_ASSET)} disabled={disabled}>
              Load sample
            </button>
          </div>

          <div className="row">
            <span className="lbl" style={{ margin: 0 }} id="mkt-lbl">
              Markets
            </span>
            <span className="seg" role="group" aria-labelledby="mkt-lbl">
              {MARKETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={markets.includes(m)}
                  onClick={() => toggleMarket(m)}
                  disabled={disabled}
                >
                  {m}
                </button>
              ))}
            </span>
          </div>
        </div>

        {error && (
          <p className="err" style={{ marginTop: 14 }}>
            <span aria-hidden="true">▲</span> {error}
          </p>
        )}
      </div>

      {/* The passes are the actual pipeline modules under src/lib/pipeline, not
          a marketing list. If a pass is added there, it belongs here too. */}
      <section className="passes-section" aria-label="What each review checks">
        <p className="passes-h">Each claim is checked for</p>
        <div className="passes">
          {[
          ["Substantiation", "Is the claim supported by cited evidence?"],
          ["Fair balance", "Is benefit stated without matching risk?"],
          ["Comparative", "Is a head-to-head claim backed by a head-to-head trial?"],
          ["Off-label", "Does the copy reach beyond the approved indication?"],
          ["Safety omission", "Are known adverse events left unsaid?"],
          ["Adverse events", "Do tolerability claims survive real FAERS signals?"],
          ["Interactions", "Are contraindicated combinations acknowledged?"],
          ["Regulatory", "Does the wording meet market-specific rules?"],
          ["Citation quality", "Is the source current, primary and real?"],
          ["IP / novelty", "Does the patent record support a first-in-class claim?"],
          ["Market claim", "Is a #1-prescribed or share claim backed by filings?"],
          ].map(([name, q]) => (
            <div className="pass" key={name}>
              <span className="pass-n">{name}</span>
              <span className="pass-q">{q}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* -------------------------------- verdict -------------------------------- */

function Verdict({
  result,
  counts,
  unchecked,
  decided,
  total,
  sevFilter,
  setSevFilter,
  undecidedOnly,
  setUndecidedOnly,
  onGenerateDossier,
}: {
  result: ReviewResult;
  counts: { critical: number; warning: number; info: number };
  unchecked: boolean;
  decided: number;
  total: number;
  sevFilter: Set<Severity>;
  setSevFilter: (s: Set<Severity>) => void;
  undecidedOnly: boolean;
  setUndecidedOnly: (b: boolean) => void;
  onGenerateDossier: (drug: string) => void;
}) {
  function toggleSev(s: Severity) {
    const n = new Set(sevFilter);
    if (n.has(s)) n.delete(s);
    else n.add(s);
    setSevFilter(n);
  }

  const headline = unchecked
    ? "Not checked"
    : counts.critical > 0
      ? `${counts.critical} critical issue${counts.critical === 1 ? "" : "s"}`
      : counts.warning > 0
        ? "No critical issues"
        : "Clean — nothing flagged";

  const sev: Severity = unchecked
    ? "warning"
    : counts.critical > 0
      ? "critical"
      : counts.warning > 0
        ? "warning"
        : "info";

  return (
    <div className="verdict" data-sev={unchecked ? "muted" : sev}>
      <div className="verdict-top">
        <h2>
          <span className={`sev ${unchecked ? "muted" : sev}`} aria-hidden="true">
            {unchecked ? "?" : SEV_GLYPH[sev]}
          </span>
          {headline}
        </h2>
        {result.drugName && <span className="drug">{result.drugName}</span>}
        {result.drugName && (
          <button
            className="quiet sm"
            style={{ marginLeft: "auto" }}
            onClick={() => onGenerateDossier(result.drugName)}
          >
            Evidence dossier →
          </button>
        )}
      </div>

      <div className="tally">
        <FilterChip
          cls="crit"
          on={sevFilter.has("critical")}
          onClick={() => toggleSev("critical")}
          glyph={SEV_GLYPH.critical}
          n={counts.critical}
          label="critical"
        />
        <FilterChip
          cls="warn"
          on={sevFilter.has("warning")}
          onClick={() => toggleSev("warning")}
          glyph={SEV_GLYPH.warning}
          n={counts.warning}
          label="to review"
        />
        <FilterChip
          cls="ok"
          on={sevFilter.has("info")}
          onClick={() => toggleSev("info")}
          glyph={SEV_GLYPH.info}
          n={counts.info}
          label="supported"
        />
        <button
          className="chip"
          aria-pressed={undecidedOnly}
          onClick={() => setUndecidedOnly(!undecidedOnly)}
        >
          Undecided only
        </button>
        <span className="chip" style={{ cursor: "default", borderStyle: "dashed" }}>
          <span className="ct">{result.claims.length}</span> claims
        </span>
      </div>

      {total > 0 && (
        <div className="prog">
          <span className="prog-txt">Decisions</span>
          <span className="prog-bar">
            <span className="prog-fill" style={{ width: `${(decided / total) * 100}%` }} />
          </span>
          <span className="prog-txt">
            {decided} / {total}
          </span>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  cls,
  on,
  onClick,
  glyph,
  n,
  label,
}: {
  cls: string;
  on: boolean;
  onClick: () => void;
  glyph: string;
  n: number;
  label: string;
}) {
  return (
    <button className={`chip ${cls}`} aria-pressed={on} onClick={onClick} disabled={n === 0}>
      <span className="g" aria-hidden="true">
        {glyph}
      </span>
      <span className="ct">{n}</span> {label}
    </button>
  );
}

/* --------------------------------- utils --------------------------------- */

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  h: {
    onStage: (e: AuditEntry) => void;
    onDone: (r: ReviewResult) => void;
    onFail: (msg: string) => void;
  },
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);

      let event = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (!data.length) continue;

      let payload: unknown;
      try {
        payload = JSON.parse(data.join("\n"));
      } catch {
        continue;
      }

      if (event === "stage") h.onStage(payload as AuditEntry);
      else if (event === "done") h.onDone(payload as ReviewResult);
      else if (event === "fail") h.onFail((payload as { error: string }).error);
    }
  }
}

function downloadJson(filename: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
