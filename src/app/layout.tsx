import type { Metadata, Viewport } from "next";
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
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  try {
    if (process.env.NEXT_PUBLIC_REDIRECT_URI) {
      return new URL(process.env.NEXT_PUBLIC_REDIRECT_URI).origin;
    }
  } catch {
    /* malformed redirect URI — fall through to the dev default */
  }
  return "http://localhost:3000";
})();

const LOGO_URL = new URL(
  "/brand/openmlr-logo.png",
  SITE_URL,
).toString();

/**
 * The X account to credit on the card, if there is one.
 *
 * X reads twitter:site / twitter:creator to attach an attribution line to the
 * card. Both are optional and are only emitted when set, because an unset or
 * wrong handle is worse than none: X silently drops the whole attribution and
 * some crawlers treat the malformed tag as a reason to distrust the card.
 */
const X_SITE = process.env.NEXT_PUBLIC_TWITTER_SITE;
const X_CREATOR = process.env.NEXT_PUBLIC_TWITTER_CREATOR;

const DESCRIPTION =
  "OpenMLR is an open-source MLR pre-check that extracts promotional claims and tests them against labelling, trial records and literature, with citations.";

const SHORT_DESCRIPTION =
  "Open-source MLR review. Every promotional claim checked against biomedical evidence, with a citation for every finding.";

const SOCIAL_IMAGES = [
  {
    url: "https://files.catbox.moe/h9i6us.png",
    width: 1200,
    height: 630,
    alt: "OpenMLR - check every claim against the evidence.",
  },
  {
    url: "/og/openmlr.png",
    width: 1200,
    height: 630,
    alt: "OpenMLR - check every claim against the evidence.",
  },
];

/** Matches the hero on the landing page, so the tab, the search result and the
 *  first thing on screen all say the same thing. Declared once — it appears in
 *  the document title, the Open Graph card and the Twitter card. */
const TITLE = "OpenMLR: Check every claim against the evidence";

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
  icons: {
    icon: [
      {
        url: "/brand/openmlr-favicon-inverted-v2-32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/brand/openmlr-favicon-inverted-v2-48.png",
        sizes: "48x48",
        type: "image/png",
      },
      {
        url: "/brand/openmlr-favicon-inverted-v2-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/brand/openmlr-favicon-inverted-v2-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    /* ?v=3 is a cache-buster: the .ico frames were rebuilt to match the PNGs
       above, and Chrome keeps favicons in a store that ignores no-cache. */
    shortcut: "/brand/openmlr-favicon-inverted-v2.ico?v=3",
    apple: [{ url: "/brand/openmlr-apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  /* Open Graph is the card Slack, LinkedIn, Discord, WhatsApp and iMessage all
     read. The first image is hosted externally; the second is the local static
     fallback in case the hosted copy is unavailable. */
  openGraph: {
    type: "website",
    siteName: "OpenMLR",
    title: TITLE,
    description: SHORT_DESCRIPTION,
    url: "/",
    locale: "en_US",
    images: SOCIAL_IMAGES,
  },
  /* summary_large_image is the 1200x630 card. */
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: SHORT_DESCRIPTION,
    images: SOCIAL_IMAGES,
    ...(X_SITE ? { site: X_SITE } : {}),
    ...(X_CREATOR ? { creator: X_CREATOR } : {}),
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  /* Adding OpenMLR to an iOS home screen: open in its own window, and label it
     with the short name rather than the full <title>, which would be truncated
     to something unreadable under the icon. */
  appleWebApp: { capable: true, title: "OpenMLR", statusBarStyle: "default" },
  /* Safari heuristically linkifies bare numbers as phone numbers. This app puts
     dose strings, A1C percentages, NCT ids and label section numbers on screen —
     all of which it has mangled into tel: links in the past. */
  formatDetection: { telephone: false, date: false, address: false, email: false },
  /* Send the origin, not the full path, to anything a reviewer clicks through
     to. A review URL contains an id that is not the referrer's business. */
  referrer: "origin-when-cross-origin",
};

/**
 * Structured data, for the search results and AI answers that quote products
 * rather than link them.
 *
 * Strictly what is verifiable from this repository: what the software is, that
 * it runs in a browser, that it is MIT-licensed, and who wrote it. No ratings,
 * no price, no invented organisation — every one of those is a claim schema.org
 * consumers will surface as fact, and this is an app whose entire premise is
 * that unsupported claims are a problem.
 */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "OpenMLR",
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Medical-Legal-Regulatory review",
  operatingSystem: "Any (web)",
  url: SITE_URL,
  description: DESCRIPTION,
  license: "https://spdx.org/licenses/MIT.html",
  inLanguage: "en",
  author: {
    "@type": "Person",
    name: "Prosper Otemuyiwa",
    url: "https://github.com/unicodeveloper",
  },
};

/**
 * Viewport.
 *
 * Next's default is `width=device-width, initial-scale=1`, which is the right
 * baseline — this states it rather than inheriting it, and adds the two things
 * the default leaves out.
 *
 * `viewportFit: "cover"` lets the page paint under a notch and the home
 * indicator, which is what makes the `env(safe-area-inset-*)` values in
 * globals.css non-zero. Without it the browser letterboxes the page instead
 * and the masthead sits inside a black bar in landscape.
 *
 * `themeColor` colours the browser's own chrome — the address bar on Android,
 * the status bar area on iOS — to match the app's paper, in whichever theme is
 * in force. Two entries, keyed on the OS preference, because these are read by
 * the browser before any script runs, so they cannot follow the in-app pin.
 *
 * Deliberately absent: `maximumScale` and `userScalable`. Pinch-zoom is an
 * accessibility affordance, and this app puts 10.5px mono timestamps and
 * source snippets on screen. Nothing here is worth taking that away for.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4f0" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1211" },
  ],
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
        <meta property="og:logo" content={LOGO_URL} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        {/* JSON-LD, not microdata: it stays out of the markup the app renders,
            so nothing about the design can accidentally invalidate it. Safe to
            stringify here — every value is a literal in this file, none of it is
            user input. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
      </head>
      <body>
        <AuthInitializer>{children}</AuthInitializer>
      </body>
    </html>
  );
}
