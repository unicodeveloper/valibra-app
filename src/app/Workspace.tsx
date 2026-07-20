"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ReviewView } from "./views/ReviewView";
import { DossierView } from "./views/DossierView";
import { LibraryView } from "./views/LibraryView";
import { ResearchView } from "./views/ResearchView";
import { HistoryView } from "./views/HistoryView";
import { ThemeToggle } from "./components/ThemeToggle";
import { SignInModal, UserMenu } from "./components/auth";
import { authorizedHeaders, handleAuthFailure } from "./stores/auth-store";
import { DR_LABELS, isDone, type DrKind, type DrTask } from "./dr";
import type { ReviewResult } from "@/lib/schemas";
import type { Decision } from "./review-model";

export type View = "review" | "history" | "library" | "dossier" | "research";

const TABS: { id: View; label: string }[] = [
  { id: "review", label: "Review" },
  { id: "history", label: "History" },
  { id: "library", label: "Library" },
  { id: "dossier", label: "Dossier" },
  { id: "research", label: "Research" },
];

interface Toast {
  id: number;
  title: string;
  sub?: string;
  action?: { label: string; run: () => void };
}

/** DeepResearch tasks are kept in sessionStorage, not just React state, for two
 *  reasons that arrived together with routing: (1) opening a saved review is now
 *  a real navigation to /review/[id], which remounts this shell — without a
 *  store the in-flight task list would vanish mid-run; (2) a plain refresh would
 *  have dropped them too. Session (not local) scope is deliberate: these tasks
 *  belong to the tab's working session, and polling resumes on rehydrate. */
const DR_STORAGE_KEY = "valibra_dr_tasks";

function loadDrTasks(): DrTask[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(DR_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * The application shell: masthead, tab views, DeepResearch polling and toasts.
 *
 * Rendered by both `/` and `/review/[id]`, which is what makes a reopened review
 * a real, refreshable URL. `initialReviewId` (from the route param) is loaded on
 * mount; `initialView` picks the starting tab.
 *
 * Tab switching stays client-side rather than per-tab routing — the tabs are a
 * workspace, not a set of pages — so only the one thing a reviewer needs to
 * bookmark or refresh into, an individual review, gets its own address.
 */
export function Workspace({
  initialReviewId,
  initialView = "review",
}: {
  initialReviewId?: string;
  initialView?: View;
}) {
  const router = useRouter();

  const [view, setView] = useState<View>(initialView);
  const [dossierDrug, setDossierDrug] = useState("");
  const [autoDrug, setAutoDrug] = useState<string | undefined>();

  const [drTasks, setDrTasks] = useState<DrTask[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // A review reopened from history, handed to ReviewView to load. The nonce lets
  // reopening the same review twice still re-trigger the load.
  const [reopened, setReopened] = useState<{
    nonce: number;
    result: ReviewResult;
    decisions: Record<string, Decision>;
  } | null>(null);

  // True while a /review/[id] URL is being fetched, so the Review tab shows a
  // load state instead of flashing the empty compose form before the review
  // arrives.
  const [reviewLoading, setReviewLoading] = useState(Boolean(initialReviewId));

  // Set when a /review/[id] URL points at a review that can't be loaded. Shown
  // as an honest inline "not found" rather than a silent bounce home — a toast
  // wouldn't survive the redirect's remount anyway, and the truthful URL lets
  // the reviewer see what they landed on.
  const [reviewError, setReviewError] = useState<string | null>(null);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 9000);
  }, []);

  // Rehydrate DR tasks once on mount (client-only, so it can't desync SSR).
  useEffect(() => {
    const stored = loadDrTasks();
    if (stored.length) setDrTasks(stored);
  }, []);

  // Mirror DR tasks to sessionStorage so a route change or refresh keeps them.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(DR_STORAGE_KEY, JSON.stringify(drTasks));
    } catch {
      /* private mode / quota — polling still works this session */
    }
  }, [drTasks]);

  /** Fetch a saved review into the Review tab. Used on mount for /review/[id]. */
  const loadReview = useCallback(async (id: string) => {
    setReviewLoading(true);
    setReviewError(null);
    setView("review");
    try {
      const r = await fetch(`/api/reviews/${id}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not open that review.");
      setReopened({ nonce: Date.now(), result: data.result, decisions: data.decisions ?? {} });
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : "Could not open that review.");
    } finally {
      setReviewLoading(false);
    }
  }, []);

  // Load the review named in the URL. Re-runs if the id changes (client-side nav
  // between two /review/[id] URLs reuses this mounted shell).
  useEffect(() => {
    if (initialReviewId) void loadReview(initialReviewId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialReviewId]);

  /** Open a saved review at its own URL, so a refresh reloads it. */
  const openReview = useCallback(
    (id: string) => {
      router.push(`/review/${id}`);
    },
    [router],
  );

  function generateDossierFor(drug: string) {
    setDossierDrug(drug);
    setAutoDrug(drug);
    setView("dossier");
  }

  const startDr = useCallback(
    async (kind: DrKind, input: string) => {
      if (!input.trim()) return;
      setView("research");
      try {
        const headers = await authorizedHeaders({ "Content-Type": "application/json" });
        const r = await fetch("/api/deepresearch", {
          method: "POST",
          headers,
          body: JSON.stringify({ kind, input }),
        });
        const data = await r.json();
        if (!r.ok) {
          if (handleAuthFailure(r.status, data)) {
            throw new Error("Please sign in with Valyu to start deep research.");
          }
          throw new Error(data.error || "Failed to start deep research.");
        }
        setDrTasks((prev) => [
          {
            taskId: data.taskId,
            kind,
            input,
            feature: data.feature,
            dataset: data.dataset,
            status: data.status || "queued",
            title: null,
            output: null,
            sources: [],
            error: null,
            startedAt: Date.now(),
          },
          ...prev,
        ]);
      } catch (e) {
        pushToast({
          title: "Couldn't start deep research",
          sub: e instanceof Error ? e.message : undefined,
        });
      }
    },
    [pushToast],
  );

  // Poll in-flight tasks; announce completion wherever the reviewer is.
  useEffect(() => {
    const pending = drTasks.filter((t) => t.taskId && !isDone(t.status));
    if (pending.length === 0) return;

    const iv = setInterval(async () => {
      for (const t of pending) {
        try {
          // The poll reaches into the task owner's account, so it carries the
          // same token the create did.
          const headers = await authorizedHeaders();
          const r = await fetch(`/api/deepresearch?id=${encodeURIComponent(t.taskId)}`, { headers });
          const s = await r.json();
          if (!r.ok) continue;

          setDrTasks((prev) =>
            prev.map((x) =>
              x.taskId === t.taskId
                ? {
                    ...x,
                    status: s.status,
                    title: s.title,
                    output: s.output,
                    sources: s.sources ?? [],
                    error: s.error,
                  }
                : x,
            ),
          );

          if (isDone(s.status)) {
            pushToast(
              s.status === "completed"
                ? {
                    title: `Deep research ready — ${DR_LABELS[t.kind]}`,
                    sub: `“${t.input.slice(0, 56)}${t.input.length > 56 ? "…" : ""}”`,
                    action: { label: "View", run: () => setView("research") },
                  }
                : {
                    title: `Deep research ${s.status} — ${DR_LABELS[t.kind]}`,
                    sub: s.error ?? undefined,
                  },
            );
          }
        } catch {
          /* transient — keep polling */
        }
      }
    }, 4000);
    return () => clearInterval(iv);
  }, [drTasks, pushToast]);

  const runningCount = drTasks.filter((t) => !isDone(t.status)).length;

  // Roving arrow-key navigation, per the tabs pattern.
  function onTabKey(e: React.KeyboardEvent, i: number) {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (i + d + TABS.length) % TABS.length;
    setView(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  return (
    <>
      <header className="mast">
        <div className="mast-inner">
          <div className="brand">
            <span className="mark" aria-hidden="true" />
            <h1>Valibra</h1>
            <span className="by">Open MLR pre-check · powered by Valyu</span>
          </div>

          <nav className="nav" role="tablist" aria-label="Workspace">
            {TABS.map((t, i) => (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={view === t.id}
                aria-controls="panel"
                tabIndex={view === t.id ? 0 : -1}
                onClick={() => setView(t.id)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {t.label}
                {t.id === "research" && runningCount > 0 && (
                  <span
                    className="dot"
                    aria-label={`${runningCount} task${runningCount === 1 ? "" : "s"} running`}
                  />
                )}
              </button>
            ))}
          </nav>

          <ThemeToggle />
          <UserMenu />
        </div>
      </header>

      <main id="panel" role="tabpanel" aria-labelledby={`tab-${view}`}>
        {view === "review" &&
          (reviewLoading ? (
            <div className="wrap narrow">
              <div className="panel" aria-busy="true" style={{ marginTop: 20 }}>
                <div className="sk" style={{ height: 13, width: "40%", marginBottom: 14 }} />
                <div className="sk" style={{ height: 13, width: "90%", marginBottom: 10 }} />
                <div className="sk" style={{ height: 13, width: "82%", marginBottom: 10 }} />
                <div className="sk" style={{ height: 13, width: "66%" }} />
              </div>
            </div>
          ) : reviewError ? (
            <div className="wrap narrow">
              <div className="empty" style={{ marginTop: 32 }}>
                <div className="ico" aria-hidden="true">
                  ⚠
                </div>
                <h3>That review couldn’t be opened</h3>
                <p>{reviewError}</p>
                <button style={{ marginTop: 14 }} onClick={() => router.push("/")}>
                  Start a new review
                </button>
              </div>
            </div>
          ) : (
            <ReviewView
              onGenerateDossier={generateDossierFor}
              onStartDr={startDr}
              reopened={reopened}
            />
          ))}
        {view === "history" && <HistoryView onOpen={openReview} />}
        {view === "library" && <LibraryView />}
        {view === "dossier" && (
          <DossierView
            drug={dossierDrug}
            setDrug={setDossierDrug}
            autoDrug={autoDrug}
            onStartDr={startDr}
          />
        )}
        {view === "research" && <ResearchView tasks={drTasks} onStart={startDr} />}
      </main>

      {/* Announced politely so a completion reaches a screen reader wherever the
          reviewer happens to be. */}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            <div className="t-body">
              <div className="t-title">{t.title}</div>
              {t.sub && <div className="t-sub">{t.sub}</div>}
            </div>
            {t.action && (
              <button
                className="t-act"
                onClick={() => {
                  t.action!.run();
                  setToasts((prev) => prev.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              className="t-x"
              aria-label="Dismiss"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <SignInModal />
    </>
  );
}
