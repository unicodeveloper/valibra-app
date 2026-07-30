/**
 * Report shaping shared by the browser and the server.
 *
 * The drawer renders a de-duplicated body and the download routes have to
 * produce the same document — a Word file that disagrees with what's on screen
 * is worse than no Word file.
 */

/**
 * Drop the report's own trailing "Sources" section.
 *
 * DeepResearch ends its markdown with a heading and a wall of bare titles and
 * URLs — the same list rendered as chips from the structured `sources` array.
 * Rendered both ways you get two Sources sections back to back, the first an
 * unstyled run of blue links. Only the last such heading is cut, and only when
 * there are structured sources to replace it, so a report that returns none
 * keeps whatever it wrote.
 */
export function stripTrailingSources(md: string): string {
  const heading = /^#{1,6}[ \t]*(sources|references|citations|bibliography)[ \t]*:?[ \t]*$/gim;
  let cut = -1;
  for (const m of md.matchAll(heading)) if (m.index !== undefined) cut = m.index;
  return cut > -1 ? md.slice(0, cut).trimEnd() : md;
}

/** The body as the reader sees it: report prose, with its duplicate source list
 *  removed when the caller will render the structured one instead. */
export function reportBody(output: string | null, sourceCount: number): string {
  const md = output ?? "";
  return sourceCount > 0 ? stripTrailingSources(md) : md;
}

/** Filesystem-safe stem for a downloaded report. */
export function reportSlug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "report"
  );
}
