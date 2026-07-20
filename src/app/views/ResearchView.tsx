"use client";

import { Markdown } from "../components/Markdown";
import { useEffect, useState } from "react";
import { DR_LABELS, DR_PLACEHOLDER, DR_SOURCE, isDone, type DrKind, type DrTask } from "../dr";

export function ResearchView({
  tasks,
  onStart,
}: {
  tasks: DrTask[];
  onStart: (kind: DrKind, input: string) => void;
}) {
  const [kind, setKind] = useState<DrKind>("device");
  const [input, setInput] = useState("");

  return (
    <div className="wrap narrow">
      <header className="view-head">
        <h2 className="view-t">Deep research</h2>
        <p className="view-sub">
          For checks whose authoritative source is a DeepResearch-only Valyu dataset: FDA Device
          Events (MAUDE), the NPI Registry, WHO ICD, CDC surveillance and BindingDB. These run
          async over a few minutes; keep working and you&apos;ll be notified when a report lands.
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
            {(Object.keys(DR_LABELS) as DrKind[]).map((k) => (
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
              if (e.key === "Enter" && input.trim()) {
                onStart(kind, input);
                setInput("");
              }
            }}
            style={{ maxWidth: 300 }}
          />
          <button
            onClick={() => {
              onStart(kind, input);
              setInput("");
            }}
            disabled={!input.trim()}
          >
            Run
          </button>
          <span className="hint" style={{ marginLeft: "auto" }}>
            {DR_SOURCE[kind]}
          </span>
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
        <div style={{ marginTop: 18 }}>
          {tasks.map((t) => (
            <DrCard key={t.taskId || t.input} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function DrCard({ task: t }: { task: DrTask }) {
  const done = isDone(t.status);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (done) return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - t.startedAt) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [done, t.startedAt]);

  const mins = Math.floor(elapsed / 60);
  const elapsedTxt = mins > 0 ? `${mins}m ${elapsed % 60}s` : `${elapsed}s`;

  return (
    <div className="dr-card">
      <div className="dr-top">
        <div style={{ minWidth: 0 }}>
          <h3 className="dr-title">{t.title || DR_LABELS[t.kind]}</h3>
          <div className="dr-meta">
            <span className={`st ${done ? t.status : "run"}`}>
              {!done && <span className="sp" aria-hidden="true" />}
              {done ? t.status : t.status || "running"}
            </span>
            <span className="tag">{t.dataset || DR_SOURCE[t.kind]}</span>
            {!done && <span className="hint">{elapsedTxt} elapsed</span>}
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            “{t.input}”
          </p>
        </div>
      </div>

      {!done && (
        <p className="hint" style={{ marginTop: 10 }}>
          Running on Valyu DeepResearch. This can take a few minutes — you can navigate away and
          you&apos;ll be notified when it&apos;s ready.
        </p>
      )}

      {t.error && (
        <p className="err" style={{ marginTop: 10 }}>
          <span aria-hidden="true">▲</span> {t.error}
        </p>
      )}

      {t.output && (
        <div className="dsec" style={{ marginTop: 8 }}>
          <div className="body">
            <Markdown>{t.output}</Markdown>
          </div>
        </div>
      )}

      {t.sources.length > 0 && (
        <div className="dsec">
          <h3>Sources</h3>
          <div className="sources">
            {t.sources.map((s, i) =>
              s.url ? (
                <a
                  key={i}
                  className="src-chip"
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  title={s.title || s.url}
                >
                  <span className="n">{i + 1}</span>
                  {truncate(s.title || s.url, 44)}
                </a>
              ) : (
                <span key={i} className="src-chip" title={s.title}>
                  <span className="n">{i + 1}</span>
                  {truncate(s.title, 44)}
                </span>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}
