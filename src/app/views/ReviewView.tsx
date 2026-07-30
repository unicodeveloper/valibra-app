"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AuditEntry, Finding, ReviewResult, Severity } from "@/lib/schemas";
import { SAMPLE_ASSET } from "../sample-asset";
import { AssetSheet } from "../components/AssetSheet";
import { SampleMenu } from "../components/SampleMenu";
import { FindingCard, type RevisionDraft } from "../components/FindingCard";
import { FindingsSkeleton, RunProgress, stageOf } from "../components/RunProgress";
import {
  SEV_GLYPH,
  CATEGORY_LABEL,
  anchorClaims,
  countBySeverity,
  groupByClaim,
  isUnchecked,
  datasetLabel,
  type Decision,
  type DecisionNote,
} from "../review-model";
import type { DrKind } from "../dr";
import { authorizedHeaders, handleAuthFailure, useAuthStore } from "../stores/auth-store";
import { anonId } from "../anon-id";
import { isValyuMode } from "@/lib/app-mode";
import { stashPendingReview, peekPendingReview, takePendingReview } from "../pending-review";
import { track } from "../track";

/**
 * One non-US option, not two.
 *
 * EU and UK were separate buttons but the same retrieval: anything that isn't US
 * goes to the UK legislation and case-law sources (see searchUkRegulatory). There
 * is no EMA/EudraLex corpus behind an "EU" selection, so offering it as its own
 * market promised a European grounding the review couldn't deliver — and then
 * printed "EU" in the provenance bar over UK sources. The label now says what
 * actually gets searched.
 *
 * Legacy reviews stored "EU" or "UK" alone; those values still render fine in
 * history, they simply can't be re-selected here.
 */
const MARKETS = ["US", "UK/EU"] as const;
type Market = (typeof MARKETS)[number];

/** Compact absolute timestamp for the duplicate-review prompt. */
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "recently";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ReviewView({
  onGenerateDossier,
  onStartDr,
  reopened,
}: {
  onGenerateDossier: (drug: string) => void;
  onStartDr: (kind: DrKind, input: string) => void;
  /** A past review pulled from history, with the decisions (and their notes)
   *  already made on it. */
  reopened?: {
    result: ReviewResult;
    decisions: Record<string, { decision: Decision; rationale?: string; suggestedRevision?: string }>;
  } | null;
}) {
  const [assetName, setAssetName] = useState("Ozempic");
  const [assetText, setAssetText] = useState(SAMPLE_ASSET);
  const [markets, setMarkets] = useState<Market[]>(["US"]);

  const router = useRouter();

  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [doneStages, setDoneStages] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  // True while showing the pre-computed sample review — a full, cited result
  // served statically so a first-time visitor sees the tool work instantly, with
  // no run, no cost, and no account. The "see it work" tier of the free trial.
  const [isSample, setIsSample] = useState(false);
  // Set when the server recognizes an identical recent asset, so the reviewer
  // can reopen the prior review instead of unknowingly re-spending credits.
  const [duplicate, setDuplicate] = useState<{
    id: string;
    asset_name: string;
    created_at: string;
  } | null>(null);

  // Triage state
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  // Per-finding rationale + suggested revision, kept beside the decision value.
  const [notes, setNotes] = useState<Record<string, DecisionNote>>({});
  // Refs mirror the two maps so the persist closure always sees the latest of
  // both — a decision write must carry the current note, and vice versa.
  const decisionsRef = useRef(decisions);
  decisionsRef.current = decisions;
  const notesRef = useRef(notes);
  notesRef.current = notes;
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
  // Set when a free review is claimed into a new account on sign-in — the payoff
  // the conversion wall promised. Auto-dismisses.
  const [claimed, setClaimed] = useState(false);

  // Subscribed (not read imperatively) so the restore-on-sign-in effect fires the
  // moment a conversion completes and the store flips authenticated.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!claimed) return;
    const t = setTimeout(() => setClaimed(false), 6000);
    return () => clearTimeout(t);
  }, [claimed]);

  /** Persist a claimed free-run review into the now-signed-in account. */
  const claimReview = useCallback(async (r: ReviewResult) => {
    try {
      const headers = await authorizedHeaders({ "Content-Type": "application/json" });
      const resp = await fetch("/api/reviews/claim", {
        method: "POST",
        headers,
        body: JSON.stringify({ result: r }),
      });
      if (resp.ok) {
        track("review_claimed", { reviewId: r.reviewId });
        setClaimed(true); // deliver the "saved to your library" payoff
      }
    } catch {
      /* best-effort — the review still shows on screen even if the save fails */
    }
  }, []);

  /**
   * On sign-in, restore any work stashed at the wall — the typed asset, and the
   * free review they ran — and claim that review into the new account so it
   * becomes their first saved review. Runs once per conversion (the stash is
   * consumed).
   */
  useEffect(() => {
    if (!isAuthenticated) return;
    const pending = takePendingReview();
    if (!pending) return;
    setAssetName(pending.assetName || "");
    setAssetText(pending.assetText || "");
    if (pending.markets?.length) setMarkets(pending.markets as Market[]);
    if (pending.result) {
      setIsSample(false);
      setResult(pending.result);
      setOpenIds(
        new Set(
          pending.result.findings.filter((f) => f.severity === "critical").map((f) => f.id),
        ),
      );
      void claimReview(pending.result);
    }
  }, [isAuthenticated, claimReview]);

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
    // Split the persisted records back into the decision map (drives buttons,
    // counts, carry-forward) and the notes map (rationale + suggested revision).
    const dec: Record<string, Decision> = {};
    const nts: Record<string, DecisionNote> = {};
    for (const [id, rec] of Object.entries(reopened.decisions)) {
      dec[id] = rec.decision;
      if (rec.rationale || rec.suggestedRevision) {
        nts[id] = { rationale: rec.rationale, suggestedRevision: rec.suggestedRevision };
      }
    }
    setDecisions(dec);
    setNotes(nts);
    setActiveClaimId(null);
    setOpenIds(
      new Set(
        reopened.result.findings
          .filter((f) => f.severity === "critical" && !dec[f.id])
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

  const runReview = useCallback(
    async (force = false) => {
    // No client-side auth gate: a first-time visitor is allowed to run one free
    // review (the server meters it on the deployment key). The server decides —
    // it either runs the trial or returns requiresSignup, which raises the wall
    // below. This is what turns "sign in first" into "try it, then sign up".

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setRunning(true);
    setStartedAt(Date.now());
    setDoneStages(new Set());
    setError(null);
    setResult(null);
    setIsSample(false);
    setDuplicate(null);
    setDecisions({});
    setNotes({});
    setOpenIds(new Set());
    setActiveClaimId(null);
    setUnsaved(0);
    setClaimed(false);

    try {
      // In valyu mode this attaches the reviewer's token so the run bills their
      // credits; in self-hosted mode it's a no-op and the server pays.
      const headers = await authorizedHeaders({
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        // The free-trial meter (server ignores it for signed-in requests).
        "x-anon-id": anonId(),
      });
      const res = await fetch("/api/review", {
        method: "POST",
        headers,
        body: JSON.stringify({ assetText, assetName, markets, force }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        // Free trial used up → the conversion wall (sign UP with framing), not a
        // generic sign-in and not a sign-out. Preserve their work across the
        // OAuth round-trip — keep any already-stashed free-run result, otherwise
        // at least their typed asset.
        if (data.requiresSignup) {
          if (!peekPendingReview()?.result) {
            stashPendingReview({ assetText, assetName, markets });
          }
          track("wall_shown", { reason: "run_limit" });
          useAuthStore.getState().openSignInModal({
            title: "You've seen it work",
            lede:
              data.error ||
              "Connect your Valyu account to run more reviews and save your work.",
          });
          return;
        }
        // An expired/absent session reopens sign-in rather than showing a raw error.
        if (handleAuthFailure(res.status, data)) {
          setError("Please sign in with Valyu to run a review.");
          return;
        }
        throw new Error(data.error || `Review failed (${res.status}).`);
      }

      // Non-streaming fallback: any deploy that buffers the response still works.
      // The duplicate signal also comes back as plain JSON, so it's caught here.
      if (!res.headers.get("content-type")?.includes("text/event-stream")) {
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        // Recent identical asset — offer to reopen it rather than re-run blindly.
        if (data.duplicate) {
          setDuplicate(data.previous);
          return;
        }
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
      // A free (anonymous) run: stash it so a later sign-in can restore and claim
      // it into the new account instead of losing it.
      if (!useAuthStore.getState().isAuthenticated) {
        stashPendingReview({ assetText, assetName, markets, result: r });
        track("anon_run_completed", { findings: r.findings.length });
      }
    }
  }, [assetText, assetName, markets]);

  /**
   * Load the pre-computed sample review — a full, cited result served statically
   * (public/sample-review.json). Instant, no API run, no cost, no account: the
   * "see it work" moment for a first-time visitor.
   */
  const loadSampleReview = useCallback(async () => {
    try {
      const r = await fetch("/sample-review.json");
      if (!r.ok) return;
      const result = (await r.json()) as ReviewResult;
      track("sample_viewed");
      abortRef.current?.abort();
      setRunning(false);
      setError(null);
      setDuplicate(null);
      setDecisions({});
      setNotes({});
      setActiveClaimId(null);
      setIsSample(true);
      setAssetName(result.assetName || "Sample review");
      setAssetText(result.assetText ?? "");
      setResult(result);
      setOpenIds(
        new Set(result.findings.filter((f) => f.severity === "critical").map((f) => f.id)),
      );
    } catch {
      /* a missing sample just leaves the compose view as-is */
    }
  }, []);

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
   * Persist a finding's current decision + note server-side. Append-only: each
   * write is a new row, so a note edit and a decision change are both recorded.
   * Optimistic callers update local state first; this just mirrors it to the DB.
   */
  const persist = useCallback(
    (id: string, decision: Decision, note: DecisionNote | undefined) => {
      const reviewId = result?.reviewId;
      if (!reviewId) return;
      // Acting on a free review (deciding, annotating) is a high-intent moment —
      // an anon can't persist, so instead of a doomed POST, raise the conversion
      // wall. The decision still shows locally; signing in saves it and the review.
      if (!useAuthStore.getState().isAuthenticated) {
        useAuthStore.getState().openSignInModal({
          title: "Save your review",
          lede: "Connect your Valyu account to keep your decisions and save this review to your library.",
        });
        return;
      }
      void (async () => {
        const headers = await authorizedHeaders({ "Content-Type": "application/json" });
        const r = await fetch(`/api/reviews/${reviewId}/decisions`, {
          method: "POST",
          headers,
          // Un-deciding is recorded as "cleared", not as an absence — the audit
          // trail should show the reviewer changed their mind.
          body: JSON.stringify({
            findingId: id,
            decision: decision ?? "cleared",
            rationale: note?.rationale,
            suggestedRevision: note?.suggestedRevision,
          }),
        });
        const data = await r.json().catch(() => ({}));
        // A dead session mid-triage reopens sign-in rather than silently dropping.
        if (handleAuthFailure(r.status, data)) return;
        if (!r.ok) throw new Error(data.error || `Save failed (${r.status}).`);
        if (data.persisted === false && data.reason === "persistence_disabled") setPersistOff(true);
      })().catch(() => setUnsaved((n) => n + 1));
    },
    [result],
  );

  /** Set a finding's decision (keyboard-speed) and persist it with its note. */
  const decide = useCallback(
    (id: string, d: Decision) => {
      setDecisions((prev) => ({ ...prev, [id]: d }));
      persist(id, d, notesRef.current[id]);
    },
    [persist],
  );

  /** Save a finding's rationale / suggested revision (on blur), with its decision. */
  const setNote = useCallback(
    (id: string, note: DecisionNote) => {
      setNotes((prev) => ({ ...prev, [id]: note }));
      persist(id, decisionsRef.current[id] ?? null, note);
    },
    [persist],
  );

  /** Ask the server for a grounded revision draft for one finding. */
  const draftRevision = useCallback(async (finding: Finding): Promise<RevisionDraft | null> => {
    try {
      const headers = await authorizedHeaders({ "Content-Type": "application/json" });
      const r = await fetch("/api/suggest-revision", {
        method: "POST",
        headers,
        body: JSON.stringify({
          claimText: finding.claimText ?? "",
          category: finding.category,
          headline: finding.headline,
          detail: finding.detail,
          evidence: finding.evidence.map((e) => ({ title: e.title, url: e.url, snippet: e.snippet })),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (handleAuthFailure(r.status, data)) return null;
      if (!r.ok || !data.kind) return null;
      return data as RevisionDraft;
    } catch {
      return null;
    }
  }, []);

  // F16 carry-forward: claims this owner already CONFIRMED in a prior review.
  // Only confirmations carry — a rejected claim is dropped from library matching
  // upstream ("never reused"), so it never surfaces a libraryMatch here and is
  // always re-verified fresh. Provisional (pipeline-only, no human ruling) is
  // not a decision to carry.
  const pendingCarry = useMemo(
    () =>
      (result?.findings ?? []).filter(
        (f) => f.libraryMatch?.status === "confirmed" && decisions[f.id] !== "accepted",
      ),
    [result, decisions],
  );

  /** Record the reviewer's prior confirmations on this review, attributed to
   *  them. Not automatic — a decision only enters the audit trail because the
   *  human asked. */
  function applyPreviousRulings() {
    for (const f of pendingCarry) decide(f.id, "accepted");
  }

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
      if (k !== "a" && k !== "r" && k !== "e") return;
      const card = t?.closest<HTMLElement>(".finding");
      if (!card) return;
      const id = card.id.replace(/^finding-/, "");
      e.preventDefault();
      // Route through decide() so a keyboard decision persists exactly like a
      // clicked one. E = request revision.
      const want: Decision = k === "a" ? "accepted" : k === "e" ? "revision" : "rejected";
      decide(id, decisions[id] === want ? null : want);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result, decide, decisions]);

  /**
   * The exportable artifacts are the "keep it" payoff — gate them behind an
   * account so an anon's high-intent "I want to take this with me" becomes the
   * conversion wall rather than a free download.
   */
  function requireAccountForExport(): boolean {
    if (useAuthStore.getState().isAuthenticated) return true;
    useAuthStore.getState().openSignInModal({
      title: "Save & export",
      lede: "Connect your Valyu account to export this review and save it to your library.",
    });
    return false;
  }

  function exportReport() {
    if (!result || !requireAccountForExport()) return;
    const payload = {
      ...result,
      decisions,
      notes,
      exportedAt: new Date().toISOString(),
      decisionSummary: {
        decided: decidedCount,
        total,
        accepted: Object.values(decisions).filter((d) => d === "accepted").length,
        revision: Object.values(decisions).filter((d) => d === "revision").length,
        rejected: Object.values(decisions).filter((d) => d === "rejected").length,
      },
    };
    downloadJson(`mlr-review-${result.reviewId.slice(0, 8)}.json`, payload);
  }

  /**
   * The loop-closing artifact: the consolidated change list the content team
   * acts on. Only findings the reviewer wants changed — revise or remove — each
   * with its reason, suggested revision, and citation.
   */
  function exportRevisionRequest() {
    if (!result || !requireAccountForExport()) return;
    const items = result.findings.filter(
      (f) => decisions[f.id] === "revision" || decisions[f.id] === "rejected",
    );
    const L: string[] = [
      `# Revision request — ${result.assetName}`,
      "",
      `Product: ${result.drugName || "—"}  ·  Generated: ${new Date().toLocaleString()}`,
      `${items.length} change${items.length === 1 ? "" : "s"} requested.`,
      "",
    ];
    if (items.length === 0) {
      L.push("_No changes requested — every finding was accepted or left undecided._");
    }
    items.forEach((f, i) => {
      const note = notes[f.id] ?? {};
      const verb = decisions[f.id] === "rejected" ? "Remove" : "Revise";
      const cite = f.evidence[0];
      L.push(`## ${i + 1}. ${verb} — ${CATEGORY_LABEL[f.category] ?? f.category}`);
      L.push("");
      L.push(`**Claim:** ${f.claimText ?? "—"}`);
      L.push(`**Finding:** ${f.headline}${f.detail ? ` — ${f.detail}` : ""}`);
      if (note.rationale) L.push(`**Reason:** ${note.rationale}`);
      if (note.suggestedRevision) L.push(`**Suggested revision:** ${note.suggestedRevision}`);
      if (cite) L.push(`**Source:** ${cite.title}${cite.url ? ` — ${cite.url}` : ""}`);
      L.push("");
    });
    downloadText(`revision-request-${result.reviewId.slice(0, 8)}.md`, L.join("\n"));
  }

  /* -------------------------------- render ------------------------------- */

  if (!result && !running) {
    return (
      <div className="wrap compose-wrap">
        <Compose
          assetName={assetName}
          setAssetName={setAssetName}
          assetText={assetText}
          setAssetText={setAssetText}
          markets={markets}
          toggleMarket={toggleMarket}
          onRun={() => {
            // Clicking Run on the untouched sample would waste the one free run
            // reproducing the cached sample. Show the cached one (free, instant)
            // instead — editing the asset to their own content triggers a real run.
            if (!isAuthenticated && assetText.trim() === SAMPLE_ASSET.trim()) {
              void loadSampleReview();
            } else {
              void runReview();
            }
          }}
          onSeeSample={loadSampleReview}
          disabled={false}
          error={error}
          notice={
            duplicate ? (
              <div className="banner warn" role="status">
                <span aria-hidden="true">●</span>
                <div>
                  <p className="b-t">You already reviewed this asset</p>
                  <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 12.5 }}>
                    “{duplicate.asset_name}” was reviewed {fmtWhen(duplicate.created_at)}. Reopen
                    that review, or re-run to spend credits on a fresh one.
                  </p>
                  <div className="row" style={{ marginTop: 10 }}>
                    <button className="sm" onClick={() => router.push(`/review/${duplicate.id}`)}>
                      Open previous review
                    </button>
                    <button className="ghost sm" onClick={() => runReview(true)}>
                      Re-run anyway
                    </button>
                  </div>
                </div>
              </div>
            ) : null
          }
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
                setIsSample(false);
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
                  <button className="sm" onClick={() => runReview(true)}>
                    Retry
                  </button>
                </div>
              </div>
            </div>
          )}

          {result && (
            <>
              {claimed && (
                <div className="banner ok" role="status">
                  <span aria-hidden="true">✓</span>
                  <div>
                    <p className="b-t">Saved to your library</p>
                    <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 12.5 }}>
                      Your review is in your account — reopen it any time from History.
                    </p>
                  </div>
                </div>
              )}
              {isSample && (
                <div className="banner info" role="status">
                  <span aria-hidden="true">✦</span>
                  <div>
                    <p className="b-t">This is a sample review</p>
                    <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 12.5 }}>
                      A real, fully-cited review of a sample asset — every finding below links to its
                      source. Paste your own asset to run one free.
                    </p>
                    <div className="row" style={{ marginTop: 10 }}>
                      <button
                        className="sm"
                        onClick={() => {
                          setResult(null);
                          setIsSample(false);
                          setAssetText("");
                          setAssetName("");
                        }}
                      >
                        Review your own asset →
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* A free-run result for an anonymous reviewer: name the moment
                  softly so the sign-up wall on their next action isn't a cold
                  surprise, and offer the path proactively. Valyu mode only —
                  self-hosted has no accounts to sign into. */}
              {!isSample && !isAuthenticated && isValyuMode() && (
                <div className="banner info" role="status">
                  <span aria-hidden="true">✦</span>
                  <div>
                    <p className="b-t">That was your free review</p>
                    <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 12.5 }}>
                      Sign in with Valyu to save it to your library and run more.
                    </p>
                    <div className="row" style={{ marginTop: 10 }}>
                      <button
                        className="sm"
                        onClick={() =>
                          useAuthStore.getState().openSignInModal({
                            title: "Save your review",
                            lede: "Connect your Valyu account to run more reviews and save your work.",
                          })
                        }
                      >
                        Sign in with Valyu
                      </button>
                    </div>
                  </div>
                </div>
              )}
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
                      <button className="sm" onClick={() => runReview(true)}>
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

              {pendingCarry.length > 0 && (
                <div className="banner info" role="status">
                  <span aria-hidden="true">↻</span>
                  <div>
                    <p className="b-t">
                      You confirmed {pendingCarry.length} of these claim
                      {pendingCarry.length === 1 ? "" : "s"} in an earlier review
                    </p>
                    <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 12.5 }}>
                      Accept them on this review too — recorded as your decision in the audit trail.
                    </p>
                    <div className="row" style={{ marginTop: 10 }}>
                      <button className="sm" onClick={applyPreviousRulings}>
                        Accept {pendingCarry.length} previously confirmed
                      </button>
                    </div>
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
                      note={notes[f.id] ?? {}}
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
                      onNote={(note) => setNote(f.id, note)}
                      onDraftRevision={() => draftRevision(f)}
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
                <button className="sm" onClick={exportRevisionRequest}>
                  ↓ Export revision request
                </button>
                <button className="ghost sm" onClick={exportReport}>
                  Annotated report (JSON)
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
  onSeeSample,
  disabled,
  error,
  notice,
}: {
  assetName: string;
  setAssetName: (s: string) => void;
  assetText: string;
  setAssetText: (s: string) => void;
  markets: Market[];
  toggleMarket: (m: Market) => void;
  onRun: () => void;
  onSeeSample: () => void;
  disabled: boolean;
  error: string | null;
  /** Optional bar shown above the form (e.g. the duplicate-review notice). */
  notice?: ReactNode;
}) {
  return (
    <div className="compose">
      {/* The hero spans the full width on its own row; below it the form and the
          checks it runs sit as two equal-size cards sharing one row and height. */}
      <header className="compose-head">
        <h2>Check every claim against the evidence</h2>
        <p className="compose-lede">
          OpenMLR tests each promotional claim against approved labelling, trial records and the
          literature — every finding cites its source, for you to accept or reject.
        </p>
        {/* Chips and the sample link share a row: two stacked rows of secondary
            detail was most of what pushed the landing past one screen. */}
        <div className="compose-meta">
          <ul className="compose-trust">
            <li>Grounded in licensed evidence</li>
            <li>Every finding cites its source</li>
            <li>Open source · MIT</li>
          </ul>
          <button type="button" className="see-sample" onClick={onSeeSample}>
            See a completed review — no sign-up
            <span aria-hidden="true"> →</span>
          </button>
        </div>
      </header>

      {notice && <div className="compose-notice">{notice}</div>}

      <div className="compose-body">
      <div className="compose-form">
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
            <button onClick={() => onRun()} disabled={disabled || !assetText.trim()}>
              Run review
            </button>
            <SampleMenu
              onPick={(s) => {
                setAssetText(s.text);
                setAssetName(s.name);
              }}
              disabled={disabled}
            />
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
  downloadBlob(filename, JSON.stringify(obj, null, 2), "application/json");
}

function downloadText(filename: string, text: string) {
  downloadBlob(filename, text, "text/markdown");
}

function downloadBlob(filename: string, data: string, type: string) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
