"use client";

import { useEffect, useState } from "react";

/**
 * The review pipeline, made legible while it runs.
 *
 * A review fans out across dozens of Valyu and LLM calls and takes tens of
 * seconds. The old UI spent that entire time showing the word "Reviewing…",
 * which reads as a hang. These stages are driven by the *real* audit trail
 * streamed from the pipeline — nothing here is simulated, so a stage only ticks
 * over when the work behind it actually finished.
 */

export interface Stage {
  id: string;
  label: string;
  /** Audit steps that belong to this stage. */
  steps: string[];
}

export const STAGES: Stage[] = [
  { id: "read", label: "Reading the asset", steps: ["ingest"] },
  { id: "extract", label: "Extracting claims", steps: ["extract"] },
  { id: "label", label: "Retrieving the FDA label", steps: ["label", "library"] },
  { id: "verify", label: "Substantiating claims against evidence", steps: ["verify"] },
  { id: "balance", label: "Checking fair balance & off-label", steps: ["fair-balance", "off-label"] },
  {
    id: "safety",
    label: "Cross-checking safety signals",
    steps: ["adverse-events", "safety-omission", "interactions"],
  },
  {
    id: "claims",
    label: "Assessing comparative, IP & market claims",
    steps: ["comparative", "ip", "market-claim", "citation-quality"],
  },
  { id: "reg", label: "Grounding in FDA precedent", steps: ["regulatory"] },
  { id: "assemble", label: "Assembling findings", steps: ["provenance", "assemble", "deep-research"] },
];

const STEP_TO_STAGE = new Map<string, string>();
for (const s of STAGES) for (const step of s.steps) STEP_TO_STAGE.set(step, s.id);

/** Which stage does this audit step belong to? */
export function stageOf(step: string): string | undefined {
  return STEP_TO_STAGE.get(step);
}

export function RunProgress({
  doneStages,
  startedAt,
}: {
  doneStages: Set<string>;
  startedAt: number;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(iv);
  }, [startedAt]);

  // The first stage not yet reported is the one currently running.
  const activeIdx = STAGES.findIndex((s) => !doneStages.has(s.id));

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <span className="lbl" style={{ margin: 0 }}>
          Running review
        </span>
        <span className="prog-txt">{elapsed}s elapsed</span>
      </div>

      <div className="stages" aria-live="polite" aria-atomic="false">
        {STAGES.map((s, i) => {
          const state = doneStages.has(s.id) ? "done" : i === activeIdx ? "active" : "todo";
          return (
            <div className="stage" data-s={state} key={s.id}>
              <span className="si" aria-hidden="true">
                {state === "done" ? "✓" : ""}
              </span>
              <span>{s.label}</span>
              {state === "active" && <span className="sd">working…</span>}
            </div>
          );
        })}
      </div>

      <p className="hint" style={{ marginTop: 12 }}>
        Retrieval and entailment run across every claim in parallel. Nothing is generated without a
        source — the model never writes a citation it did not retrieve.
      </p>
    </div>
  );
}

/** Skeleton for the findings column while the first result lands. */
export function FindingsSkeleton() {
  return (
    <div aria-hidden="true">
      {[92, 74, 84].map((w, i) => (
        <div className="finding" key={i} style={{ padding: "13px 15px" }}>
          <div className="row" style={{ gap: 11, flexWrap: "nowrap", alignItems: "flex-start" }}>
            <div className="sk" style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div className="sk" style={{ height: 11, width: `${w}%`, marginBottom: 8 }} />
              <div className="sk" style={{ height: 8, width: "38%" }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
