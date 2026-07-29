"use client";

import { Markdown } from "./Markdown";
import { useEffect, useRef, useState } from "react";
import { DR_LABELS, DR_SOURCE, isDone, type DrTask } from "../dr";

/**
 * The list of deep-research tasks, and the drawer for reading one.
 *
 * Shared by the Research and Dossier tabs: a dossier is a DeepResearch run like
 * any other, so both tabs list the same shape of work. Each tab keeps its own
 * empty state and its own launcher — only the reading surface is common.
 */
export function DrTaskList({ tasks }: { tasks: DrTask[] }) {
  /** The report being read, or null. Held by task id rather than by object so a
   *  poll that replaces the task (status → completed) doesn't strand the drawer
   *  on a stale copy. */
  const [openId, setOpenId] = useState<string | null>(null);
  const openTask = tasks.find((t) => t.taskId === openId) ?? null;

  return (
    <>
      <div style={{ marginTop: 18 }}>
        {tasks.map((t) => (
          <DrCard key={t.taskId || t.localId || t.input} task={t} onOpen={() => setOpenId(t.taskId)} />
        ))}
      </div>
      {openTask && <ReportDrawer task={openTask} onClose={() => setOpenId(null)} />}
    </>
  );
}

function DrCard({ task: t, onOpen }: { task: DrTask; onOpen: () => void }) {
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

      {/* A finished report is thousands of words. Inlining it buried every other
          task on the page and made a list of two reports unreadable — so the card
          carries only enough to recognise the report, and the report itself opens
          in a drawer. */}
      {t.output && (
        <>
          <p className="dr-excerpt">{excerpt(t.output)}</p>
          <div className="dr-actions">
            <button className="ghost sm" onClick={onOpen}>
              Open report →
            </button>
            {t.sources.length > 0 && (
              <span className="hint">
                {t.sources.length} source{t.sources.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The full report, in a panel over the page rather than in the list.
 *
 * A drawer rather than a route: the reports are session state, so there's
 * nothing to link to, and reading one is a glance away from the list you'd want
 * to come back to.
 */
function ReportDrawer({ task: t, onClose }: { task: DrTask; onClose: () => void }) {
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const title = t.title || DR_LABELS[t.kind];
  const dataset = t.dataset || DR_SOURCE[t.kind];
  const stem = slug(`${title}-${t.input}`) + "-" + new Date().toISOString().slice(0, 10);
  // What the reader is actually looking at — the same de-duplicated body the
  // drawer renders, so a download is never a different document to the screen.
  const body = t.sources.length > 0 ? stripTrailingSources(t.output ?? "") : t.output ?? "";

  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    // The page behind must not scroll under the drawer.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // Send focus back to the card's button, or the reviewer is dropped at the
      // top of the document with no idea where they were.
      restoreTo?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="drawer-scrim" role="presentation" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <h2 className="drawer-t" id="drawer-title">
              {t.title || DR_LABELS[t.kind]}
            </h2>
            <div className="dr-meta">
              <span className="tag">{t.dataset || DR_SOURCE[t.kind]}</span>
              <span className="hint">“{t.input}”</span>
            </div>
          </div>
          <button className="drawer-x" aria-label="Close report" onClick={onClose}>
            ✕
          </button>
        </header>

        {/* A finished report is a document someone has to hand on — to a
            reviewer, into a submission, onto a shared drive. Every format here
            is built in the browser from what's already on screen; none needs a
            round trip or a dependency. */}
        <div className="drawer-tools">
          <span className="hint">Download</span>
          <button
            className="ghost sm"
            onClick={() => save(`${stem}.md`, toMarkdown(t, title, dataset, body), "text/markdown")}
          >
            Markdown
          </button>
          <button
            className="ghost sm"
            onClick={() => save(`${stem}.txt`, toText(t, title, dataset, body), "text/plain")}
          >
            Text
          </button>
          <button
            className="ghost sm"
            onClick={() =>
              save(
                `${stem}.html`,
                toHtml(title, dataset, t.input, bodyRef.current?.innerHTML ?? ""),
                "text/html",
              )
            }
          >
            HTML
          </button>
          {/* Print rather than a generated file: the browser's own PDF export
              honours the print stylesheet, and shipping a PDF renderer to do
              the same job would cost more than the feature is worth. */}
          <button className="ghost sm" onClick={() => window.print()}>
            PDF
          </button>
        </div>

        <div className="drawer-body" ref={bodyRef}>
          {body && <Markdown>{body}</Markdown>}

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
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------- export -- */

/** Hand the browser a file. Revoked on a delay — Safari cancels the download if
 *  the object URL disappears in the same tick as the click. */
function save(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "report"
  );
}

/** The sources as a numbered list, for the text-shaped formats. */
function sourceLines(t: DrTask): string {
  return t.sources
    .map((s, i) => `${i + 1}. ${s.title || s.url}${s.url ? ` — ${s.url}` : ""}`)
    .join("\n");
}

function stamp(t: DrTask, dataset: string): string {
  return `${dataset} · “${t.input}” · ${new Date().toISOString().slice(0, 10)}`;
}

function toMarkdown(t: DrTask, title: string, dataset: string, body: string): string {
  const sources = t.sources.length ? `\n\n## Sources\n\n${sourceLines(t)}` : "";
  return `# ${title}\n\n_${stamp(t, dataset)}_\n\n${body}${sources}\n`;
}

function toText(t: DrTask, title: string, dataset: string, body: string): string {
  const sources = t.sources.length ? `\n\nSOURCES\n\n${sourceLines(t)}` : "";
  const rule = "=".repeat(Math.min(title.length, 60));
  return `${title}\n${rule}\n${stamp(t, dataset)}\n\n${toPlainText(body)}${sources}\n`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}

/**
 * A standalone HTML file, built from the markup already rendered in the drawer
 * — so the download matches the screen exactly, source chips included, without
 * a second markdown renderer that could disagree with the first. Styles are
 * inlined because the file has to open anywhere, offline, with no app around it.
 */
function toHtml(title: string, dataset: string, input: string, renderedBody: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { max-width: 46rem; margin: 3rem auto; padding: 0 1.25rem;
         font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  h1 { font-size: 1.6rem; letter-spacing: -0.02em; margin: 0 0 .25rem; }
  .meta { color: #6b7280; font-size: .85rem; margin: 0 0 2rem; }
  h2, h3 { line-height: 1.25; margin: 2rem 0 .5rem; }
  a { color: #0f766e; }
  pre, code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: .9em; }
  pre { overflow-x: auto; padding: .75rem 1rem; background: #f3f4f6; border-radius: 6px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e5e7eb; padding: .4rem .6rem; text-align: left; }
  .sources { display: flex; flex-wrap: wrap; gap: .4rem; }
  .src-chip { display: inline-flex; gap: .4rem; align-items: center; padding: .25rem .6rem;
              border: 1px solid #e5e7eb; border-radius: 999px; font-size: .8rem;
              text-decoration: none; color: inherit; }
  .src-chip .n { color: #9ca3af; font-size: .7rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #0e1211; color: #e7ebe8; }
    .meta { color: #9ca3af; }
    pre { background: #1a201f; }
    th, td, .src-chip { border-color: #2b3331; }
  }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${escapeHtml(dataset)} · “${escapeHtml(input)}” · ${new Date().toISOString().slice(0, 10)}</p>
${renderedBody}
</body>
</html>
`;
}

/**
 * Markdown to readable prose, keeping paragraph breaks and list markers — this
 * feeds the .txt download, where structure still has to survive. (`excerpt`
 * below flattens far harder, because it has one line to work with.)
 */
function toPlainText(md: string): string {
  return md
    .replace(/```[a-z]*\n([\s\S]*?)```/gi, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1 ($2)")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Drop the report's own trailing "Sources" section.
 *
 * DeepResearch ends its markdown with a heading and a wall of bare titles and
 * URLs — the same list we render as chips below, from the structured `sources`
 * array. Rendered both ways you get two Sources sections back to back, the first
 * an unstyled run of blue links. Only the last such heading is cut, and only
 * when there are chips to replace it, so a report that returns no structured
 * sources keeps whatever it wrote.
 */
function stripTrailingSources(md: string): string {
  const heading = /^#{1,6}[ \t]*(sources|references|citations|bibliography)[ \t]*:?[ \t]*$/gim;
  let cut = -1;
  for (const m of md.matchAll(heading)) if (m.index !== undefined) cut = m.index;
  return cut > -1 ? md.slice(0, cut).trimEnd() : md;
}

/**
 * First couple of lines of a report as plain prose — enough to tell two reports
 * apart at a glance. Markdown syntax is stripped rather than rendered: half a
 * heading or a dangling list marker reads as broken, not as a preview.
 */
function excerpt(md: string, max = 260): string {
  const text = md
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → their text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // headings
    .replace(/^\s{0,3}>\s?/gm, "") // block quotes
    .replace(/^\s{0,3}([-*+]|\d+[.)])\s+/gm, "") // list markers
    .replace(/^\s*\|.*\|\s*$/gm, " ") // table rows
    .replace(/[*_`~]/g, "") // emphasis / code ticks
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}
