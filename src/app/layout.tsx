import type { Metadata } from "next";
import { Public_Sans, Source_Serif_4, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

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
  title: "Substantia — open MLR review",
  description:
    "Open-source, Valyu-grounded MLR pre-check. Every claim checked against real biomedical evidence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
