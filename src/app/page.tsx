"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ReviewView } from "./views/ReviewView";
import { DossierView } from "./views/DossierView";
import { LibraryView } from "./views/LibraryView";
import { ResearchView } from "./views/ResearchView";
import { DR_LABELS, isDone, type DrKind, type DrTask } from "./dr";

type View = "review" | "library" | "dossier" | "research";

const TABS: { id: View; label: string }[] = [
  { id: "review", label: "Review" },
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

export default function Page() {
  const [view, setView] = useState<View>("review");
  const [dossierDrug, setDossierDrug] = useState("");
  const [autoDrug, setAutoDrug] = useState<string | undefined>();

  // DeepResearch tasks live at the top level so a task can report completion
  // even after the reviewer navigates away from the Research tab.
  const [drTasks, setDrTasks] = useState<DrTask[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 9000);
  }, []);

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
        const r = await fetch("/api/deepresearch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, input }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Failed to start deep research.");
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
          const r = await fetch(`/api/deepresearch?id=${encodeURIComponent(t.taskId)}`);
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
            <span className="mark" aria-hidden="true">
              ◆
            </span>
            <h1>Substantia</h1>
            <span className="by">Open MLR pre-check · grounded in Valyu</span>
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
        </div>
      </header>

      <main id="panel" role="tabpanel" aria-labelledby={`tab-${view}`}>
        {view === "review" && <ReviewView onGenerateDossier={generateDossierFor} onStartDr={startDr} />}
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
    </>
  );
}
