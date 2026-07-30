"use client";

import { useEffect, useState } from "react";
import { authorizedHeaders, handleAuthFailure } from "../stores/auth-store";

interface ReviewSummary {
  id: string;
  asset_name: string;
  drug_name: string;
  created_at: string;
  finding_count: number;
  decided_count: number;
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Past reviews. Reopening one restores the findings AND the decisions already
 * made on it, so triage can be picked up where it was left rather than re-run
 * (a re-run costs a full fan-out of Valyu calls and can return different
 * evidence — the stored review is the record).
 */
export function HistoryView({ onOpen }: { onOpen: (id: string) => void }) {
  const [reviews, setReviews] = useState<ReviewSummary[] | null>(null);
  const [persist, setPersist] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/reviews", { headers: await authorizedHeaders() });
      const data = await r.json();
      // In valyu mode history is per-account; an expired session reopens sign-in.
      if (handleAuthFailure(r.status, data)) return;
      if (!r.ok) throw new Error(data.error || "Could not load review history.");
      setReviews(data.reviews ?? []);
      setPersist(Boolean(data.persistenceEnabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load review history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="wrap narrow">
      {/* A bordered card holding only a title and a Refresh button read as a
          stray box floating above the table it belonged to. It's a view header,
          so it's typeset as one rather than boxed. */}
      <header className="view-head">
        <h2 className="view-t">Review history</h2>
        {reviews && (
          <span className="view-ct">
            {reviews.length} review{reviews.length === 1 ? "" : "s"}
          </span>
        )}
        <div className="view-act">
          <button id="hist-reload" className="quiet" onClick={() => load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        <p className="view-sub">
          Every review that has been run, with how many of its findings you have decided on.
          Reopening one restores the asset, its findings and your decisions.
        </p>

        {error && (
          <p className="err">
            <span aria-hidden="true">▲</span> {error}
          </p>
        )}
      </header>

      {persist === false && (
        <div className="banner warn" style={{ marginTop: 14 }}>
          <span aria-hidden="true">●</span>
          <div>
            <p className="b-t">Persistence is off — no history is being kept</p>
            <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 12.5 }}>
              Start Postgres with <code>docker compose up -d</code> and set <code>DATABASE_URL</code>{" "}
              to keep reviews and the decisions made on them. Reviews still run fine without it —
              export the report to keep a record.
            </p>
          </div>
        </div>
      )}

      {loading && !reviews && (
        <div className="panel" style={{ marginTop: 14 }} aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <div className="sk" key={i} style={{ height: 13, width: `${95 - i * 9}%`, marginBottom: 12 }} />
          ))}
        </div>
      )}

      {/* tbl-stack: below 620px each row becomes a card and each cell a
          labelled line, driven by the data-label attributes below — a
          six-column table does not fit a phone, and scrolling it sideways
          separates a review from the count that belongs to it. */}
      {reviews && reviews.length > 0 && (
        <div className="tbl-scroll tbl-stack" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Drug</th>
                <th>Reviewed</th>
                <th className="num">Findings</th>
                <th className="num">Decided</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => {
                const done = r.finding_count > 0 && r.decided_count >= r.finding_count;
                return (
                  <tr key={r.id}>
                    {/* data-label carries the column header down into the cell
                        for the stacked layout. The action cell deliberately has
                        none — it is a button, not a labelled value. */}
                    <td className="claim-c" data-label="Asset">
                      {r.asset_name}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }} data-label="Drug">
                      {r.drug_name || "—"}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }} data-label="Reviewed">
                      {when(r.created_at)}
                    </td>
                    <td className="num" data-label="Findings">
                      {r.finding_count}
                    </td>
                    <td className="num" data-label="Decided">
                      <span className={`vd ${done ? "supported" : "partial"}`}>
                        <span aria-hidden="true">{done ? "✓" : "●"}</span>
                        {r.decided_count}/{r.finding_count}
                      </span>
                    </td>
                    <td className="num">
                      <button
                        className="ghost sm"
                        disabled={opening === r.id}
                        onClick={() => {
                          setOpening(r.id);
                          onOpen(r.id);
                        }}
                      >
                        {opening === r.id ? "Opening…" : "Open"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {reviews && reviews.length === 0 && persist && (
        <div className="empty" style={{ marginTop: 14 }}>
          <div className="ico" aria-hidden="true">
            ☰
          </div>
          <h3>No reviews yet</h3>
          <p>
            Run a review and it lands here — with every accept and reject you make, so you can close
            the tab and pick the triage back up later.
          </p>
        </div>
      )}
    </div>
  );
}
