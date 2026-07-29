"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ReviewView } from "./views/ReviewView";
import { DossierView } from "./views/DossierView";
import { LibraryView } from "./views/LibraryView";
import { ResearchView } from "./views/ResearchView";
import { HistoryView } from "./views/HistoryView";
import { ThemeToggle } from "./components/ThemeToggle";
import { SignInGate, SignInModal, UserMenu } from "./components/auth";
import { authorizedHeaders, handleAuthFailure, useAuthStore } from "./stores/auth-store";
import { isValyuMode } from "@/lib/app-mode";
import { notifyReportReady } from "./notify";
import { DR_LABELS, DR_SOURCE, isDone, type DrKind, type DrTask } from "./dr";
import type { ReviewResult } from "@/lib/schemas";
import type { Decision } from "./review-model";

export type View = "review" | "history" | "library" | "dossier" | "research";

/** Kept in step with the `title` in app/layout.tsx — the badge below rewrites
 *  document.title, so it needs the unbadged string to restore. */
const BASE_TITLE = "OpenMLR — Check every claim against the evidence";

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

/**
 * DeepResearch tasks come from the server, owner-scoped, not from browser
 * storage.
 *
 * They used to live in sessionStorage. That survived a remount and a refresh,
 * but it belonged to the *tab* rather than to an account: signing out left the
 * previous reviewer's reports — title, query, full body, sources — sitting there
 * for whoever signed in next. And since a run costs real credits and takes
 * minutes, tab-scoped state also meant signing out lost work already paid for.
 *
 * Reading them from `/api/deepresearch?mine=1` fixes both: the list follows the
 * account, so it survives sign-out, a reload and a different machine, and it can
 * never be read by the wrong one.
 */
async function fetchDrTasks(): Promise<DrTask[]> {
  const r = await fetch("/api/deepresearch?mine=1", { headers: await authorizedHeaders() });
  if (!r.ok) return [];
  const data = await r.json();
  const rows: unknown[] = Array.isArray(data.tasks) ? data.tasks : [];
  return rows.map((row) => {
    const t = row as Record<string, unknown>;
    return {
      taskId: String(t.task_id),
      kind: t.kind as DrTask["kind"],
      input: String(t.input ?? ""),
      feature: String(t.feature ?? ""),
      dataset: String(t.dataset ?? ""),
      status: String(t.status ?? "queued"),
      title: (t.title as string | null) ?? null,
      output: (t.output as string | null) ?? null,
      sources: Array.isArray(t.sources) ? (t.sources as DrTask["sources"]) : [],
      error: (t.error as string | null) ?? null,
      startedAt: t.created_at ? new Date(String(t.created_at)).getTime() : Date.now(),
    };
  });
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

  /** Whose tasks are on screen. Drives the load below and gates polling — in
   *  self-hosted mode there is no session, so it stays null and never gates. */
  const authSub = useAuthStore((s) => s.user?.id ?? null);

  const [drTasks, setDrTasks] = useState<DrTask[]>([]);
  // One task list, split by the tab that owns each kind. Polling, persistence
  // and toasts stay on the whole list — only the rendering is partitioned.
  const dossierTasks = drTasks.filter((t) => t.kind === "dossier");
  const researchTasks = drTasks.filter((t) => t.kind !== "dossier");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // A review reopened from history, handed to ReviewView to load. The nonce lets
  // reopening the same review twice still re-trigger the load.
  const [reopened, setReopened] = useState<{
    nonce: number;
    result: ReviewResult;
    decisions: Record<string, { decision: Decision; rationale?: string; suggestedRevision?: string }>;
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

  /**
   * Reports that landed while the reviewer was looking at another tab.
   *
   * A toast is only seen by someone already on the page, and these runs take
   * minutes — the whole point is that you go and do something else. The count
   * goes in the document title, which is the one piece of the app still visible
   * from another tab.
   */
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    document.title = unseen > 0 ? `(${unseen}) ${BASE_TITLE}` : BASE_TITLE;
  }, [unseen]);

  // Coming back to the tab is the acknowledgement — no dismiss to hunt for.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setUnseen(0);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  /**
   * Load this account's DR tasks, and reload them whenever the account changes.
   *
   * Keyed on the signed-in subject rather than running once on mount: signing
   * out must empty the list, and signing in as someone else must replace it
   * rather than inherit whatever the last session left on screen.
   */
  useEffect(() => {
    if (isValyuMode() && !authSub) {
      setDrTasks([]);
      return;
    }
    let live = true;
    void fetchDrTasks()
      .then((tasks) => {
        if (live) setDrTasks(tasks);
      })
      .catch(() => {
        /* a failed load is an empty list, not a broken tab */
      });
    return () => {
      live = false;
    };
  }, [authSub]);

  /** Fetch a saved review into the Review tab. Used on mount for /review/[id]. */
  const loadReview = useCallback(async (id: string) => {
    setReviewLoading(true);
    setReviewError(null);
    setView("review");
    try {
      const r = await fetch(`/api/reviews/${id}`, { headers: await authorizedHeaders() });
      const data = await r.json();
      // A review is per-account in valyu mode; an expired session reopens sign-in.
      if (handleAuthFailure(r.status, data)) return;
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

  /* Prefills the dossier tab from a review and hands over — deliberately not
     auto-starting. A dossier is now a DeepResearch run against the reviewer's
     own Valyu credits, so the spend stays behind an explicit click. */
  function generateDossierFor(drug: string) {
    setDossierDrug(drug);
    setView("dossier");
  }

  const startDr = useCallback(
    async (kind: DrKind, input: string) => {
      if (!input.trim()) return;
      // Each kind is listed by the tab that starts it. Sending a dossier run to
      // the Research tab moved the reviewer away from the page they were working
      // on, to a list where their dossier sat among unrelated lookups.
      setView(kind === "dossier" ? "dossier" : "research");

      /**
       * Show the run before it exists.
       *
       * Creating the task is a couple of seconds of round trip to Valyu, and
       * until it returned there was nothing on screen — the reviewer landed on a
       * list that said "no tasks yet" while their task was being created, which
       * reads as a click that did nothing. This row stands in until the real id
       * arrives, and is replaced or removed by the outcome. taskId stays empty so
       * the poller skips it.
       */
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setDrTasks((prev) => [
        {
          taskId: "",
          localId,
          kind,
          input,
          feature: "",
          dataset: DR_SOURCE[kind],
          status: "starting",
          title: null,
          output: null,
          sources: [],
          error: null,
          startedAt: Date.now(),
        },
        ...prev,
      ]);

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
        // Swap the placeholder for the real task, in place, so the card the
        // reviewer is already looking at simply gains its id and starts polling.
        setDrTasks((prev) =>
          prev.map((t) =>
            t.localId === localId
              ? {
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
                }
              : t,
          ),
        );
      } catch (e) {
        // The run never started, so the placeholder must go — leaving it would
        // show a task that will never finish and can never be polled.
        setDrTasks((prev) => prev.filter((t) => t.localId !== localId));
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
    // A signed-out poll has no token, so every request 401s — and the handler
    // below swallows failures to survive a blip, which turned that into a silent
    // retry every 4s forever. The task itself keeps running on Valyu and is
    // picked up again from the server on the next sign-in.
    if (isValyuMode() && !authSub) return;
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
            // Only when they're not here to see the toast — otherwise a badge
            // would sit there counting things the reviewer just watched arrive.
            if (document.visibilityState !== "visible") setUnseen((n) => n + 1);

            // Reaches a reviewer who has left the browser entirely. Self-gates
            // on permission and on the tab being hidden, so it stays quiet for
            // anyone who never opted in or is watching the page.
            if (s.status === "completed") {
              notifyReportReady({
                title: `Deep research ready — ${DR_LABELS[t.kind]}`,
                body: `“${t.input.slice(0, 80)}${t.input.length > 80 ? "…" : ""}”`,
                tag: t.taskId,
                onClick: () => setView(t.kind === "dossier" ? "dossier" : "research"),
              });
            }

            pushToast(
              s.status === "completed"
                ? {
                    title: `Deep research ready — ${DR_LABELS[t.kind]}`,
                    sub: `“${t.input.slice(0, 56)}${t.input.length > 56 ? "…" : ""}”`,
                    // To the tab that lists this kind — a dossier is on the
                    // Dossier tab, so sending "View" to Research would land the
                    // reviewer on a page where their finished report isn't.
                    action: {
                      label: "View",
                      run: () => setView(t.kind === "dossier" ? "dossier" : "research"),
                    },
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
  }, [drTasks, pushToast, authSub]);

  // Counted per tab, not globally: the dot means "there's work running in
  // here", so a running dossier has to mark Dossier, not Research.
  const running: Partial<Record<View, number>> = {
    dossier: dossierTasks.filter((t) => !isDone(t.status)).length,
    research: researchTasks.filter((t) => !isDone(t.status)).length,
  };

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
            <h1>
              <Link href="/" className="brand-home" onClick={() => setView("review")}>
                OpenMLR
              </Link>
            </h1>
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
                {(running[t.id] ?? 0) > 0 && (
                  <span
                    className="dot"
                    aria-label={`${running[t.id]} task${running[t.id] === 1 ? "" : "s"} running`}
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
        {view === "history" && (
          <SignInGate title="Sign in to see your review history">
            <HistoryView onOpen={openReview} />
          </SignInGate>
        )}
        {view === "library" && (
          <SignInGate title="Sign in to see your claims library">
            <LibraryView />
          </SignInGate>
        )}
        {view === "dossier" && (
          <SignInGate title="Sign in to build an evidence dossier">
            <DossierView
              drug={dossierDrug}
              setDrug={setDossierDrug}
              onStartDr={startDr}
              tasks={dossierTasks}
            />
          </SignInGate>
        )}
        {view === "research" && (
          <SignInGate title="Sign in to run deep research">
            <ResearchView tasks={researchTasks} onStart={startDr} />
          </SignInGate>
        )}
      </main>

      {/* The standing disclaimer. It belongs on every view, not just the review
          output, because the whole product is a pre-check — anything it says is
          an input to a qualified reviewer's judgement, never a substitute for
          it. */}
      <footer className="foot">
        <p>
          OpenMLR — powered by Valyu. Does not replace qualified MLR review or constitute legal,
          regulatory or medical advice.
        </p>
      </footer>

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
