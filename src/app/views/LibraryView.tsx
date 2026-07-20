"use client";

import { useEffect, useState } from "react";

interface LibEntry {
  drug_name: string;
  claim_text: string;
  claim_type: string;
  verdict: string;
  confidence: number | null;
}

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

  async function load(filter = q) {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/library${filter ? `?drug=${encodeURIComponent(filter)}` : ""}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not load the library.");
      setEntries(data.entries ?? []);
      setPersist(Boolean(data.persistenceEnabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the library.");
    } finally {
      setLoading(false);
    }
  }

  // The library is the whole point of this tab — load it on arrival rather than
  // making the reviewer press a button to see an empty screen.
  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="wrap narrow">
      <div className="panel">
        <label htmlFor="libq">Claims library</label>
        <div className="row">
          <input
            id="libq"
            type="text"
            value={q}
            placeholder="Filter by drug…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            style={{ maxWidth: 260 }}
          />
          <button onClick={() => load()} disabled={loading}>
            {loading ? "Loading…" : "Search"}
          </button>
          {q && (
            <button
              className="quiet"
              onClick={() => {
                setQ("");
                void load("");
              }}
            >
              Clear
            </button>
          )}
          {entries && (
            <span className="hint" style={{ marginLeft: "auto" }}>
              {entries.length} saved claim{entries.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

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
