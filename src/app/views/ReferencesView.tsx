"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "../stores/auth-store";

/**
 * Reference packs: the reviewer's own approved source documents.
 *
 * Distinct from the Library tab, which holds claims already substantiated by
 * past reviews. That is an output; this is an input. Distinct too from the
 * Dossier tab, which generates a report about a drug: this is the opposite
 * direction, documents the reviewer supplies because the asset was written from
 * them.
 */

interface Pack {
  id: string;
  name: string;
  drugName: string | null;
  docCount: number;
  chunkCount: number;
  createdAt: string;
}

interface PendingDoc {
  filename: string;
  mime: string;
  text: string;
}

/** Plain-text formats read directly. PDFs go through pdfjs in the browser. */
const READABLE = /\.(txt|md|markdown|csv|json)$/i;
const IS_PDF = /\.pdf$/i;

export function ReferencesView() {
  const token = useAuthStore((s) => s.accessToken);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  const [name, setName] = useState("");
  const [drug, setDrug] = useState("");
  const [docs, setDocs] = useState<PendingDoc[]>([]);
  const [paste, setPaste] = useState("");
  const [saving, setSaving] = useState(false);
  /** Reading a long PDF takes a moment; without this the picker looks inert. */
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const authHeaders = useCallback(
    (): HeadersInit => (token ? { authorization: `Bearer ${token}` } : {}),
    [token],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/references", { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) {
        setNeedsSignIn(Boolean(data.requiresReauth));
        throw new Error(data.error ?? "Could not load reference packs.");
      }
      setNeedsSignIn(false);
      setPacks(data.packs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const added: PendingDoc[] = [];
    const problems: string[] = [];
    setReading(true);
    try {
      for (const f of Array.from(files)) {
        if (READABLE.test(f.name)) {
          added.push({ filename: f.name, mime: f.type || "text/plain", text: await f.text() });
          continue;
        }
        if (IS_PDF.test(f.name)) {
          try {
            // Extraction happens here, in the browser: the file itself is never
            // uploaded, only the text. That matters when the document is an
            // unpublished data-on-file memo.
            const { extractPdfText } = await import("../pdf-text");
            const { text, pages, emptyPages } = await extractPdfText(f);
            if (!text.trim()) {
              // Almost always a scanned PDF. Silently adding an empty document
              // would show a pack that looks like coverage and matches nothing.
              problems.push(
                `${f.name}: no text found across ${pages} page(s). If it is a scan, it needs OCR before it can be used.`,
              );
              continue;
            }
            if (emptyPages > 0) {
              problems.push(
                `${f.name}: ${emptyPages} of ${pages} pages had no extractable text and were skipped.`,
              );
            }
            added.push({ filename: f.name, mime: "application/pdf", text });
          } catch (e) {
            problems.push(`${f.name}: could not be read (${e instanceof Error ? e.message : "unknown error"}).`);
          }
          continue;
        }
        problems.push(`${f.name}: unsupported format. Use PDF, .txt or .md, or paste the text below.`);
      }
    } finally {
      setReading(false);
    }
    if (added.length) setDocs((d) => [...d, ...added]);
    setError(problems.length ? problems.join(" ") : null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function addPasted() {
    const text = paste.trim();
    if (!text) return;
    setDocs((d) => [
      ...d,
      { filename: `pasted-${d.length + 1}.txt`, mime: "text/plain", text },
    ]);
    setPaste("");
  }

  async function create() {
    if (!name.trim() || docs.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/references", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: name.trim(),
          drugName: drug.trim() || null,
          documents: docs,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the pack.");
      setName("");
      setDrug("");
      setDocs([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string, packName: string) {
    if (!confirm(`Delete "${packName}" and all of its documents? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/references?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not delete the pack.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const chars = docs.reduce((n, d) => n + d.text.length, 0);

  return (
    <div className="wrap narrow">
      <header className="view-head">
        <h2 className="view-t">Reference packs</h2>
        <p className="view-sub">
          The approved sources your copy was written from: prescribing information, pivotal
          manuscripts, data on file. Attach a pack to a review and every claim is checked against
          your own documents first, then against the licensed literature.
        </p>
      </header>

      {needsSignIn ? (
        <div className="empty">
          <div className="ico" aria-hidden="true">
            ⚿
          </div>
          <h3>Sign in to use reference packs</h3>
          <p>
            Packs are stored against your account so only you can see and use them. Sign in from the
            menu above.
          </p>
        </div>
      ) : (
        <>
          <div className="panel">
            <label htmlFor="pack-name">New pack</label>
            <div className="row">
              <input
                id="pack-name"
                type="text"
                value={name}
                placeholder="e.g. Ozempic 2026 core references"
                onChange={(e) => setName(e.target.value)}
                style={{ flex: 2, minWidth: 200 }}
              />
              <input
                type="text"
                value={drug}
                placeholder="Drug (optional)"
                onChange={(e) => setDrug(e.target.value)}
                style={{ flex: 1, minWidth: 130 }}
              />
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.txt,.md,.markdown,.csv,.json"
                onChange={(e) => void onFiles(e.target.files)}
                disabled={reading}
              />
              {reading && <span className="hint">Reading…</span>}
            </div>

            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="…or paste a reference here. A data-on-file memo often exists in no file at all."
              rows={4}
              style={{ marginTop: 10, width: "100%" }}
            />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="quiet sm" onClick={addPasted} disabled={!paste.trim()}>
                Add pasted text
              </button>
            </div>

            {docs.length > 0 && (
              <ul className="hint" style={{ marginTop: 12, paddingLeft: 18 }}>
                {docs.map((d, i) => (
                  <li key={`${d.filename}-${i}`}>
                    {d.filename} · {d.text.length.toLocaleString()} chars{" "}
                    <button
                      className="link xs"
                      onClick={() => setDocs((x) => x.filter((_, j) => j !== i))}
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="row" style={{ marginTop: 12, gap: 12 }}>
              <button onClick={() => void create()} disabled={!name.trim() || !docs.length || saving}>
                {saving ? "Indexing…" : `Create pack (${docs.length} doc${docs.length === 1 ? "" : "s"})`}
              </button>
              {docs.length > 0 && (
                <span className="hint">{chars.toLocaleString()} characters to index</span>
              )}
            </div>
          </div>

          {error && (
            <p className="hint" style={{ marginTop: 12 }} role="alert">
              {error}
            </p>
          )}

          {loading ? (
            <p className="hint" style={{ marginTop: 18 }}>
              Loading…
            </p>
          ) : packs.length === 0 ? (
            <div className="empty" style={{ marginTop: 18 }}>
              <div className="ico" aria-hidden="true">
                ▤
              </div>
              <h3>No reference packs yet</h3>
              <p>
                Add the documents your claims are cited to. When a claim has no match in the
                literature, a pack is the difference between “no source found” and “supported by
                your reference”.
              </p>
            </div>
          ) : (
            <div style={{ marginTop: 18 }}>
              {packs.map((p) => (
                <article className="finding" key={p.id} data-sev="info">
                  <div className="f-top" style={{ cursor: "default" }}>
                    <span className="f-mid">
                      <h3 className="f-title">{p.name}</h3>
                      <span className="f-meta">
                        {p.drugName && <span className="tag">{p.drugName}</span>}
                        <span className="tag">
                          {p.docCount} doc{p.docCount === 1 ? "" : "s"}
                        </span>
                        {/* Chunk count is the honest signal of whether the pack can
                            actually be matched. Zero chunks looks like coverage and
                            provides none, so it is called out rather than shown as a 0. */}
                        {p.chunkCount === 0 ? (
                          <span className="tag" title="Nothing was indexed, so this pack cannot match any claim.">
                            ▲ not indexed
                          </span>
                        ) : (
                          <span className="tag">{p.chunkCount} passages</span>
                        )}
                        <span className="hint" style={{ fontSize: 11 }}>
                          {p.createdAt.slice(0, 10)}
                        </span>
                      </span>
                    </span>
                    <button className="link xs danger" onClick={() => void remove(p.id, p.name)}>
                      delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
