"use client";

import { Markdown } from "../components/Markdown";
import { useEffect, useRef, useState } from "react";
import type { Dossier } from "@/lib/schemas";
import { datasetLabel } from "../review-model";
import type { DrKind } from "../dr";
import { authorizedHeaders, handleAuthFailure } from "../stores/auth-store";

interface DossierResp {
  drug: string;
  dossier: Dossier;
  sources: { title: string; url: string; source: string }[];
  error: string | null;
}

export function DossierView({
  drug,
  setDrug,
  autoDrug,
  onStartDr,
}: {
  drug: string;
  setDrug: (s: string) => void;
  autoDrug?: string;
  onStartDr: (kind: DrKind, input: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<DossierResp | null>(null);
  const ranFor = useRef<string | null>(null);

  async function generate(d: string) {
    if (!d.trim()) return;
    setLoading(true);
    setError(null);
    setResp(null);
    try {
      const headers = await authorizedHeaders({ "Content-Type": "application/json" });
      const r = await fetch("/api/dossier", {
        method: "POST",
        headers,
        body: JSON.stringify({ drug: d }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (handleAuthFailure(r.status, data)) {
          setError("Please sign in with Valyu to generate a dossier.");
          return;
        }
        throw new Error(data.error || "Dossier failed.");
      }
      setResp(data as DossierResp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dossier failed.");
    } finally {
      setLoading(false);
    }
  }

  // Auto-generate when handed a drug from a review. Guarded by ref rather than
  // a remount key so a re-render can never re-fire the request.
  useEffect(() => {
    if (autoDrug && ranFor.current !== autoDrug) {
      ranFor.current = autoDrug;
      void generate(autoDrug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDrug]);

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
            onKeyDown={(e) => e.key === "Enter" && generate(drug)}
            style={{ maxWidth: 300 }}
          />
          <button onClick={() => generate(drug)} disabled={loading || !drug.trim()}>
            {loading ? "Compiling…" : "Quick dossier"}
          </button>
          <button
            className="ghost"
            onClick={() => onStartDr("dossier", drug)}
            disabled={!drug.trim()}
            title="Async DeepResearch across every dataset, including the DeepResearch-only BindingDB."
          >
            Deep dossier →
          </button>
          {resp && (
            <button className="quiet" onClick={() => window.print()}>
              Print / PDF
            </button>
          )}
        </div>

        <div className="row" style={{ marginTop: 12, gap: 18, alignItems: "flex-start" }}>
          <p className="hint" style={{ flex: 1, minWidth: 220, margin: 0 }}>
            <strong style={{ color: "var(--ink-2)" }}>Quick dossier</strong> — real-time Search.
            Indication, efficacy, safety, interactions and gaps, every statement drawn from a
            retrieved Valyu source. Back in seconds.
          </p>
          <p className="hint" style={{ flex: 1, minWidth: 220, margin: 0 }}>
            <strong style={{ color: "var(--ink-2)" }}>Deep dossier</strong> — async DeepResearch
            across every dataset, including BindingDB for target binding affinity (F24). Lands in the
            Research tab.
          </p>
        </div>

        {error && (
          <p className="err" style={{ marginTop: 12 }}>
            <span aria-hidden="true">▲</span> {error}
          </p>
        )}
      </div>

      {loading && <DossierSkeleton />}

      {!loading && !resp && !error && (
        <div className="empty" style={{ marginTop: 18 }}>
          <div className="ico" aria-hidden="true">
            ⚗
          </div>
          <h3>No dossier yet</h3>
          <p>
            Enter a drug or molecule to compile an evidence dossier grounded in ClinicalTrials,
            PubMed, DailyMed, Open Targets and ChEMBL — or run one straight from a review.
          </p>
        </div>
      )}

      {resp && <DossierReport resp={resp} />}
    </div>
  );
}

function DossierReport({ resp }: { resp: DossierResp }) {
  const d = resp.dossier;
  const sec = (title: string, body: string) =>
    body ? (
      <section className="dsec">
        <h3>{title}</h3>
        <div className="body">
          <Markdown>{body}</Markdown>
        </div>
      </section>
    ) : null;

  return (
    <article className="report" style={{ marginTop: 18 }}>
      <h2 className="r-title">{resp.drug}</h2>
      <p className="r-sub">
        Evidence dossier · grounded in {resp.sources.length} Valyu source
        {resp.sources.length === 1 ? "" : "s"} · {new Date().toISOString().slice(0, 10)}
      </p>

      {sec("Indication", d.indication)}
      {sec("Efficacy", d.efficacySummary)}
      {sec("Safety", d.safetySummary)}
      {sec("Interactions", d.interactionsSummary)}

      {d.evidenceGaps.length > 0 && (
        <section className="dsec">
          <h3>Evidence gaps</h3>
          <ul className="gaps">
            {d.evidenceGaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </section>
      )}

      {resp.sources.length > 0 && (
        <section className="dsec">
          <h3>Sources</h3>
          <div className="sources">
            {resp.sources.map((s, i) =>
              s.url ? (
                <a key={i} className="src-chip" href={s.url} target="_blank" rel="noreferrer" title={s.title}>
                  <span className="n">{i + 1}</span>
                  {datasetLabel(s.source)}
                </a>
              ) : (
                <span key={i} className="src-chip" title={s.title}>
                  <span className="n">{i + 1}</span>
                  {datasetLabel(s.source)}
                </span>
              ),
            )}
          </div>
        </section>
      )}
    </article>
  );
}

function DossierSkeleton() {
  return (
    <div className="report" style={{ marginTop: 18 }} aria-hidden="true">
      <div className="sk" style={{ height: 26, width: "42%", marginBottom: 10 }} />
      <div className="sk" style={{ height: 9, width: "62%", marginBottom: 26 }} />
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ marginBottom: 22 }}>
          <div className="sk" style={{ height: 8, width: 78, marginBottom: 10 }} />
          <div className="sk" style={{ height: 10, width: "100%", marginBottom: 6 }} />
          <div className="sk" style={{ height: 10, width: "96%", marginBottom: 6 }} />
          <div className="sk" style={{ height: 10, width: "58%" }} />
        </div>
      ))}
    </div>
  );
}
