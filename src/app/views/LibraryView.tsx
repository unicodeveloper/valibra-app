"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authorizedHeaders, handleAuthFailure } from "../stores/auth-store";

interface LibEntry {
  drug_name: string;
  claim_text: string;
  claim_type: string;
  verdict: string;
  confidence: number | null;
  status: "provisional" | "confirmed" | "rejected";
}

/**
 * Whether a human has ruled on this claim. Confirmed entries are preferred when
 * matching a new review; rejected ones are never reused at all.
 */
const STATUS_LABEL: Record<string, string> = {
  confirmed: "✓ reviewer-confirmed",
  provisional: "· awaiting review",
  rejected: "▲ rejected — not reused",
};

const VERDICT_GLYPH: Record<string, string> = {
  supported: "✓",
  partial: "●",
  unsupported: "▲",
  contradicted: "▲",
  no_evidence: "▲",
};

/**
 * The claims library (F16): claims already substantiated in a past review, so a
 * reviewer doesn't re-litigate the same sentence every quarter.
 */
export function LibraryView() {
  const [q, setQ] = useState("");
  const [entries, setEntries] = useState<LibEntry[] | null>(null);
  const [persist, setPersist] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The in-flight request. Filtering happens per keystroke, so a slow response
   * for "met" can land after a fast one for "metformin" and overwrite the newer
   * results with staler ones. Aborting the previous request before issuing the
   * next one makes the latest keystroke authoritative, and stops the server
   * doing work for a query the reviewer has already typed past.
   */
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async (filter: string) => {
    inFlight.current?.abort();
    const ctl = new AbortController();
    inFlight.current = ctl;

    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/library${filter ? `?drug=${encodeURIComponent(filter)}` : ""}`,
        { signal: ctl.signal, headers: await authorizedHeaders() },
      );
      const data = await r.json();
      // In valyu mode the library is per-account; an expired session reopens sign-in.
      if (handleAuthFailure(r.status, data)) return;
      if (!r.ok) throw new Error(data.error || "Could not load the library.");
      setEntries(data.entries ?? []);
      setPersist(Boolean(data.persistenceEnabled));
    } catch (e) {
      // An abort is this component superseding itself, not a failure. Surfacing
      // it would flash an error on every other keystroke.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Could not load the library.");
    } finally {
      // Only the newest request owns the spinner; an aborted one must not turn
      // it off underneath its successor.
      if (inFlight.current === ctl) setLoading(false);
    }
  }, []);

  /**
   * Filter as the reviewer types. Debounced so a drug name is one request rather
   * than one per character, and re-run on every change of `q` including the
   * initial empty string, which doubles as the on-arrival load: the library is
   * the whole point of this tab, so it shows up without anyone pressing a button.
   */
  useEffect(() => {
    const t = setTimeout(() => void load(q.trim()), q ? 220 : 0);
    return () => clearTimeout(t);
  }, [q, load]);

  // Abort whatever is open if the reviewer leaves the tab mid-request.
  useEffect(() => () => inFlight.current?.abort(), []);

  return (
    <div className="wrap narrow">
      {/* Same treatment as history: a heading, not a boxed toolbar. */}
      <header className="view-head">
        <h2 className="view-t">Claims library</h2>
        {entries && (
          <span className="view-ct">
            {/* While filtering these are matches, not the library total. Saying
                "3 saved claims" when 8 are saved and 3 match is just wrong. */}
            {q
              ? `${entries.length} match${entries.length === 1 ? "" : "es"}`
              : `${entries.length} saved claim${entries.length === 1 ? "" : "s"}`}
          </span>
        )}
        <p className="view-sub">
          Verdicts you have already accepted, reused across future reviews so the same claim
          isn&apos;t re-litigated every time it appears.
        </p>
      </header>

      <div className="panel" style={{ marginBottom: 14 }}>
        <label htmlFor="libq">Filter</label>
        <div className="row">
          {/* No Search button: the results follow the field. Escape clears, which
              is what a reviewer's hands already expect from a filter input. */}
          <div className="field-clear">
            <input
              id="libq"
              type="search"
              value={q}
              placeholder="Filter by drug…"
              autoComplete="off"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && q) {
                  e.preventDefault();
                  setQ("");
                }
              }}
            />
            {q && (
              <button
                type="button"
                className="field-x"
                aria-label="Clear filter"
                onClick={() => {
                  setQ("");
                  document.getElementById("libq")?.focus();
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Reserved space, so results don't jump when this appears. */}
          <span className="filter-state" aria-hidden="true">
            {loading ? "Filtering…" : ""}
          </span>
        </div>

        {/* The count lives in the header, but a sighted-only count is invisible
            to a screen reader when results change without a page or focus move. */}
        <span className="sr-only" role="status" aria-live="polite">
          {entries
            ? `${entries.length} claim${entries.length === 1 ? "" : "s"}${q ? ` matching ${q}` : ""}`
            : ""}
        </span>

        {error && (
          <p className="err" style={{ marginTop: 12 }}>
            <span aria-hidden="true">▲</span> {error}
          </p>
        )}
      </div>

      {persist === false && (
        <div className="banner warn" style={{ marginTop: 14 }}>
          <span aria-hidden="true">●</span>
          <div>
            <p className="b-t">Persistence is off — nothing is being saved</p>
            <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 12.5 }}>
              Start Postgres with <code>docker compose up -d</code> and set <code>DATABASE_URL</code>{" "}
              to reuse substantiated claims across reviews. Reviews still run fine without it.
            </p>
          </div>
        </div>
      )}

      {loading && !entries && (
        <div className="panel" style={{ marginTop: 14 }} aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <div className="sk" key={i} style={{ height: 13, width: `${95 - i * 9}%`, marginBottom: 12 }} />
          ))}
        </div>
      )}

      {entries && entries.length > 0 && (
        <div className="tbl-scroll" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Claim</th>
                <th>Drug</th>
                <th>Type</th>
                <th>Verdict</th>
                <th>Status</th>
                <th className="num">Conf</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}>
                  <td className="claim-c">{e.claim_text}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{e.drug_name}</td>
                  <td>
                    <span className="tag">{e.claim_type}</span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span className={`vd ${e.verdict}`}>
                      <span aria-hidden="true">{VERDICT_GLYPH[e.verdict] ?? "·"}</span>
                      {e.verdict.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span className="hint" style={{ fontSize: 11.5 }}>
                      {STATUS_LABEL[e.status] ?? e.status}
                    </span>
                  </td>
                  <td className="num">
                    {e.confidence != null ? Math.round(e.confidence * 100) + "%" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* When persistence is off the banner above already explains the emptiness —
          a second panel saying the same thing is just noise. */}
      {entries && entries.length === 0 && persist && (
        <div className="empty" style={{ marginTop: 14 }}>
          <div className="ico" aria-hidden="true">
            ☰
          </div>
          <h3>{q ? `No saved claims for “${q}”` : "No saved claims yet"}</h3>
          <p>
            {q
              ? "Try a different drug, or clear the filter to see everything in the library."
              : "Run a review — every substantiated claim is saved here, and future reviews reuse it instead of re-checking the same sentence."}
          </p>
        </div>
      )}
    </div>
  );
}
