"use client";

import { useState } from "react";
import { DrTaskList } from "../components/DrTaskList";
import { NotifyOptIn } from "../components/NotifyOptIn";
import { DR_ESTIMATE_NOTE, type DrKind, type DrTask } from "../dr";

/**
 * Dossiers are DeepResearch runs, so they're async — but they belong here, not
 * in the Research tab. A tab that starts work it can never show is a dead end:
 * it navigated the reviewer away from itself and left a permanent empty state
 * pointing somewhere else.
 */
export function DossierView({
  drug,
  setDrug,
  onStartDr,
  tasks,
}: {
  drug: string;
  setDrug: (s: string) => void;
  onStartDr: (kind: DrKind, input: string) => Promise<void>;
  /** Dossier runs only — the Workspace filters before handing them over. */
  tasks: DrTask[];
}) {
  /**
   * Creating the task is a round trip to Valyu and takes a couple of seconds.
   * Without this the button sat inert the whole time and the page did nothing —
   * long enough to read as broken and to invite a second click, which would
   * start (and bill) a second run.
   */
  const [starting, setStarting] = useState(false);

  const start = async () => {
    if (!drug.trim() || starting) return;
    setStarting(true);
    try {
      await onStartDr("dossier", drug);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="wrap narrow">
      {/* Same view header as history and library, so switching tabs feels like
          arriving somewhere rather than landing on another boxed toolbar. */}
      <header className="view-head">
        <h2 className="view-t">Evidence dossier</h2>
        <p className="view-sub">
          Everything the evidence says about one drug, compiled into a document you can hand
          to someone: indication, efficacy, safety, interactions, and the gaps.
        </p>
      </header>

      <div className="panel">
        <label htmlFor="drug">Drug / molecule</label>
        <div className="row">
          <input
            id="drug"
            type="text"
            value={drug}
            placeholder="e.g. rosuvastatin"
            onChange={(e) => setDrug(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void start();
            }}
            disabled={starting}
            /* Fills the panel rather than sitting at a fixed 300px: the row is
               the only content in a full-width panel, and a short box in a wide
               pane reads as a mistake. minWidth keeps it usable once the row
               wraps on a narrow screen. */
            style={{ flex: 1, minWidth: 220 }}
          />
          <button onClick={() => void start()} disabled={!drug.trim() || starting}>
            {starting ? (
              <>
                <span className="btn-spinner" aria-hidden="true" />
                Starting…
              </>
            ) : (
              "Deep dossier →"
            )}
          </button>
        </div>

        <div className="row" style={{ marginTop: 12, gap: 14 }}>
          <p className="hint" style={{ margin: 0, maxWidth: 560 }}>
            Async DeepResearch across every dataset, including BindingDB for target binding
            affinity (F24). {DR_ESTIMATE_NOTE.dossier} You can keep working while it runs.
          </p>
          <NotifyOptIn />
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="empty" style={{ marginTop: 18 }}>
          <div className="ico" aria-hidden="true">
            ⚗
          </div>
          <h3>No dossiers yet</h3>
          <p>
            Enter a drug or molecule to compile an evidence dossier grounded in ClinicalTrials,
            PubMed, DailyMed, Open Targets, ChEMBL and BindingDB — or start one straight from a
            review. It runs in the background and lands here.
          </p>
        </div>
      ) : (
        <DrTaskList tasks={tasks} />
      )}
    </div>
  );
}
