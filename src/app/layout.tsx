import type { Metadata } from "next";
import { Public_Sans, Source_Serif_4, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { AuthInitializer } from "@/app/components/auth";

/**
 * Type system.
 *
 * Public Sans is the typeface of the US Web Design System — the register a
 * reviewer already reads FDA material in. Source Serif carries anything that is
 * a *document* (the asset under review, dossier prose) so it reads as a
 * document rather than as chrome. Plex Mono carries machine facts: ids,
 * timestamps, dataset names, the audit trail.
 */
const sans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const serif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Valibra — open MLR review",
  description:
    "Open-source, Valyu-grounded MLR pre-check. Every claim checked against real biomedical evidence.",
};

/**
 * Applies the saved theme before the first paint.
 *
 * This has to be a blocking inline script in <head>, not an effect: React runs
 * after paint, so a reviewer who has pinned dark would get a full white flash on
 * every navigation while the OS-default palette rendered first. Reading one
 * localStorage key synchronously is cheap enough to be worth blocking on.
 *
 * Wrapped in try/catch because localStorage throws outright in some privacy
 * modes, and a theme preference must never be able to take down the page.
 */
const THEME_BOOTSTRAP = `try{var t=localStorage.getItem("valibra-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* suppressHydrationWarning is required, not incidental: the bootstrap script
       below writes data-theme onto this element before React hydrates, so the
       server markup and the live DOM legitimately disagree on that one
       attribute. It suppresses the warning for <html> only, not descendants. */
    <html
      lang="en"
      className={`${sans.variable} ${serif.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <AuthInitializer>{children}</AuthInitializer>
      </body>
    </html>
  );
}
