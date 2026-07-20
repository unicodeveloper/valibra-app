"use client";

import { Streamdown } from "streamdown";
import type { BundledTheme } from "shiki";
import remarkGfm from "remark-gfm";

/**
 * The single markdown renderer for every model-authored body in the app.
 *
 * Two things are deliberately taken away from Streamdown and two are left to it.
 *
 * Taken: tables render through the design system's own table rules, inside a
 * scroll container, so a wide DeepResearch comparison matches every other table
 * in the app and scrolls in place rather than pushing the page sideways. Their
 * copy/download controls go with them — a reviewer citing a figure wants the
 * source row, not a CSV, and the buttons were the visible half of the original
 * breakage.
 *
 * Left: code blocks keep Streamdown's Shiki highlighting and its copy button,
 * which is the one control here that earns its place. Both depend on the
 * Tailwind pipeline set up in globals.css.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <Streamdown
      remarkPlugins={[remarkGfm]}
      controls={{ table: false, code: true, mermaid: false }}
      shikiTheme={SHIKI_THEME}
      components={COMPONENTS}
    >
      {children}
    </Streamdown>
  );
}

/** [light, dark] — Streamdown picks the arm matching the page's colour scheme. */
const SHIKI_THEME: [BundledTheme, BundledTheme] = ["github-light", "github-dark"];

const COMPONENTS = {
  table: ({ children, ...props }: React.ComponentProps<"table">) => (
    <div className="tbl-scroll md-tbl">
      <table {...props}>{children}</table>
    </div>
  ),
};
