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

/**
 * Absolute base for every metadata URL (og:image, twitter:image, canonical).
 * Social crawlers need absolute URLs, so this must resolve to the deployed
 * origin. It reads an explicit NEXT_PUBLIC_SITE_URL when set, otherwise reuses
 * the origin of the OAuth redirect URI — which is already configured per
 * deployment — and finally falls back to localhost for dev.
 */
const SITE_URL = (() => {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  try {
    if (process.env.NEXT_PUBLIC_REDIRECT_URI) {
      return new URL(process.env.NEXT_PUBLIC_REDIRECT_URI).origin;
    }
  } catch {
    /* malformed redirect URI — fall through to the dev default */
  }
  return "http://localhost:3000";
})();

const DESCRIPTION =
  "OpenMLR is an open-source, Valyu-grounded MLR (Medical-Legal-Regulatory) pre-check. It extracts every promotional claim and tests it against approved labelling, trial records and the peer-reviewed literature — and every finding cites its source, for a reviewer to accept or reject.";

const SHORT_DESCRIPTION =
  "Open-source, Valyu-grounded MLR review. Every promotional claim checked against real biomedical evidence — every finding cited.";

/** Matches the hero on the landing page, so the tab, the search result and the
 *  first thing on screen all say the same thing. Declared once — it appears in
 *  the document title, the Open Graph card and the Twitter card. */
const TITLE = "OpenMLR — Check every claim against the evidence";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · OpenMLR",
  },
  description: DESCRIPTION,
  applicationName: "OpenMLR",
  authors: [{ name: "OpenMLR" }],
  creator: "OpenMLR",
  publisher: "OpenMLR",
  category: "technology",
  keywords: [
    "MLR review",
    "medical legal regulatory",
    "pharma promotional review",
    "claim substantiation",
    "regulatory compliance",
    "fair balance",
    "off-label",
    "pharmacovigilance",
    "Valyu",
    "biomedical evidence",
    "open source",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "OpenMLR",
    title: TITLE,
    description: SHORT_DESCRIPTION,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: SHORT_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
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
const THEME_BOOTSTRAP = `try{var t=localStorage.getItem("openmlr-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

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
