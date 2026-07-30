"use client";

import { useState } from "react";
import { DrTaskList } from "../components/DrTaskList";
import { NotifyOptIn } from "../components/NotifyOptIn";
import {
  DR_ESTIMATE,
  DR_ESTIMATE_NOTE,
  DR_LABELS,
  DR_PLACEHOLDER,
  DR_SOURCE,
  type DrKind,
  type DrTask,
} from "../dr";

/**
 * The four targeted DeepResearch lookups. The dossier is a DR kind too, but it
 * has its own tab — it's a different job (one drug, every dataset, minutes and
 * real credits) and listing it here as a fifth dropdown entry made it the one
 * expensive run you could start without meaning to.
 */
const KINDS = (Object.keys(DR_LABELS) as DrKind[]).filter((k) => k !== "dossier");

export function ResearchView({
  tasks,
  onStart,
}: {
  tasks: DrTask[];
  onStart: (kind: DrKind, input: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<DrKind>("device");
  const [input, setInput] = useState("");
  /** Creating the task is a couple of seconds of round trip to Valyu; without
   *  feedback the button reads as dead and invites a second, billable click. */
  const [starting, setStarting] = useState(false);

  const run = async () => {
    if (!input.trim() || starting) return;
    setStarting(true);
    try {
      await onStart(kind, input);
      setInput("");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="wrap narrow">
      <header className="view-head">
        <h2 className="view-t">Deep research</h2>
        <p className="view-sub">
          For checks whose authoritative source is a DeepResearch-only Valyu dataset: FDA Device
          Events (MAUDE), the NPI Registry, WHO ICD and CDC surveillance. These run async over a
          few minutes; keep working and you&apos;ll be notified when a report lands. Targeted reports
          are estimated at 1-4 minutes depending on dataset.
        </p>
      </header>

      <div className="panel">
        <label htmlFor="dr-kind">New task</label>

        <div className="row">
          <select
            id="dr-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as DrKind)}
            style={{ maxWidth: 210 }}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {DR_LABELS[k]}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={input}
            placeholder={DR_PLACEHOLDER[kind]}
            aria-label={`Input for ${DR_LABELS[kind]}`}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run();
            }}
            disabled={starting}
            style={{ flex: 1, minWidth: 220 }}
          />
          <button onClick={() => void run()} disabled={!input.trim() || starting}>
            {starting ? (
              <>
                <span className="btn-spinner" aria-hidden="true" />
                Starting…
              </>
            ) : (
              "Run"
            )}
          </button>
          <span className="hint" style={{ marginLeft: "auto" }}>
            {DR_SOURCE[kind]} · est. {DR_ESTIMATE[kind]}
          </span>
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <p className="hint" style={{ margin: 0 }}>
            {DR_ESTIMATE_NOTE[kind]}
          </p>
          <NotifyOptIn />
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="empty" style={{ marginTop: 18 }}>
          <div className="ico" aria-hidden="true">
            ⧗
          </div>
          <h3>No deep-research tasks yet</h3>
          <p>
            Start one above, or kick one off from a review&apos;s “Requires deep research” items.
            Reports appear here and persist for the session.
          </p>
        </div>
      ) : (
        <DrTaskList tasks={tasks} />
      )}
    </div>
  );
}
