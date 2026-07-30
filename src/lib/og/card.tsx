import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The social card, as one design with per-route copy.
 *
 * Every route that can be shared renders through `socialCard()` below, so there
 * is exactly one composition to keep good and one set of colours to keep in step
 * with globals.css. The per-route copy lives in CARDS at the bottom of this file
 * — a route's opengraph-image.tsx is three lines that name a variant.
 *
 * The card is a poster of the product's own artifact rather than a logo on a
 * gradient: warm paper, the accent rail that runs down a finding card, and one
 * real claim sheet showing a claim, its verdict and the dataset the verdict came
 * from. The value proposition is demonstrated, not asserted — which is also why
 * every string here is drawn from the app's real vocabulary (SEV_WORD, the
 * dataset labels, the "claim N of M" reference) and no adjectives were added.
 *
 * Rendering constraints worth knowing before editing:
 *
 * - Satori implements a subset of CSS. Flex only (no grid, no float), no
 *   `gap` shorthand tricks worth relying on, and every element with more than
 *   one child must set `display` explicitly. Spacing is margins, not gaps.
 * - There is no font fallback chain. If a glyph is missing from the four subset
 *   files in assets/fonts it renders as a blank box, so the severity marks are
 *   drawn as SVG paths rather than typed as ▲ ● ✓ the way the DOM does it.
 * - Colours are literal hex, not var(--…): this renders outside the document,
 *   so there is no cascade to read tokens from. They are the light-theme values
 *   from globals.css, copied deliberately — a share card that flipped to dark
 *   with the viewer's OS is not a thing Open Graph can express, and paper is the
 *   product's resting state.
 */

export const SIZE = { width: 1200, height: 630 };
export const CONTENT_TYPE = "image/png";

/* ---------------------------------------------------------------- palette -- */

const PAPER = "#f5f4f0";
const SURFACE = "#ffffff";
const INK = "#16201d";
const INK_2 = "#55605c";
const INK_3 = "#8b948f";
const LINE = "#e3e6e1";
const ACCENT = "#0d6b5e";
const CRIT = "#b0362a";
const WARN = "#97620d";
const OK = "#2b7550";

type Sev = "critical" | "warning" | "info";

const SEV_COLOR: Record<Sev, string> = { critical: CRIT, warning: WARN, info: OK };

/* ------------------------------------------------------------------ fonts -- */

/**
 * The app's three typefaces, as static subsets Satori can parse.
 *
 * next/font hands the browser woff2, which Satori cannot read, so these are
 * separate files — see assets/fonts/NOTICE.txt for provenance and how they were
 * subset. Read once per server process and memoised: the read is ~100KB of disk
 * and every card needs the same four faces, so doing it per request would be
 * pure waste on a route that is otherwise cached.
 */
let fontsPromise: Promise<
  { name: string; data: ArrayBuffer | Buffer; weight: 400 | 500 | 700; style: "normal" }[]
> | null = null;

function fonts() {
  fontsPromise ??= (async () => {
    const dir = join(process.cwd(), "assets", "fonts");
    const [sans, sansBold, serif, mono] = await Promise.all([
      readFile(join(dir, "PublicSans-Regular.ttf")),
      readFile(join(dir, "PublicSans-Bold.ttf")),
      readFile(join(dir, "SourceSerif4-Regular.otf")),
      readFile(join(dir, "IBMPlexMono-Medium.ttf")),
    ]);
    return [
      { name: "Public Sans", data: sans, weight: 400 as const, style: "normal" as const },
      { name: "Public Sans", data: sansBold, weight: 700 as const, style: "normal" as const },
      { name: "Source Serif", data: serif, weight: 400 as const, style: "normal" as const },
      { name: "IBM Plex Mono", data: mono, weight: 500 as const, style: "normal" as const },
    ];
  })();
  return fontsPromise;
}

/* ------------------------------------------------------------------ parts -- */

/**
 * The severity mark, drawn rather than typed.
 *
 * The DOM uses ▲ ● ✓ (see SEV_GLYPH in review-model.ts) and these are the same
 * three shapes, as geometry. Shape carries severity here exactly as it does in
 * the app: a card that is screenshotted, re-shared and viewed at thumbnail size
 * has no business relying on a red/amber/green distinction alone.
 */
function SevMark({ sev, size = 26 }: { sev: Sev; size?: number }) {
  const color = SEV_COLOR[sev];
  if (sev === "critical") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M12 3.2 L21.5 20.4 H2.5 Z" fill={color} />
      </svg>
    );
  }
  if (sev === "warning") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.4" fill={color} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M4 12.8 L9.6 18.4 L20 6.4"
        fill="none"
        stroke={color}
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Uppercase mono — the register the app uses for machine facts. */
function Mono({
  children,
  color = INK_3,
  size = 17,
}: {
  children: string;
  color?: string;
  size?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        fontFamily: "IBM Plex Mono",
        fontWeight: 500,
        fontSize: size,
        letterSpacing: 1.6,
        textTransform: "uppercase",
        color,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
}

/**
 * One claim as it stands in a review: the claim text as a document, the verdict
 * under it, and the dataset the verdict was drawn from. The left rail is the
 * severity rail from FindingCard, and the numbered marker is the same claim
 * reference the asset sheet puts in the margin.
 */
function ClaimRow({ row }: { row: ExhibitRow }) {
  return (
    <div style={{ display: "flex" }}>
      <div style={{ display: "flex", width: 6, backgroundColor: SEV_COLOR[row.sev] }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          padding: "24px 30px 26px 26px",
        }}
      >
        {/* The claim, verbatim, in the serif the app reserves for documents. */}
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              marginTop: 4,
              marginRight: 16,
              borderRadius: 7,
              backgroundColor: PAPER,
              border: `1px solid ${LINE}`,
              fontFamily: "IBM Plex Mono",
              fontWeight: 500,
              fontSize: 16,
              color: INK_2,
            }}
          >
            {row.claimNumber}
          </div>
          <div
            style={{
              fontFamily: "Source Serif",
              fontSize: 29,
              lineHeight: 1.32,
              color: INK,
              flexGrow: 1,
            }}
          >
            {row.claim}
          </div>
        </div>

        {/* The verdict, and where it came from. */}
        <div style={{ display: "flex", alignItems: "center", marginTop: 18, marginLeft: 46 }}>
          <SevMark sev={row.sev} />
          <div
            style={{
              display: "flex",
              fontSize: 25,
              fontWeight: 700,
              letterSpacing: -0.3,
              color: SEV_COLOR[row.sev],
              marginLeft: 12,
            }}
          >
            {row.verdict}
          </div>
          <div style={{ display: "flex", flexGrow: 1 }} />
          <Mono size={16}>{row.source}</Mono>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- card -- */

export interface ExhibitRow {
  /** The claim reference the app shows in the asset margin ("claim 4"). */
  claimNumber: string;
  /** The claim, as written in the promotional asset. */
  claim: string;
  sev: Sev;
  /** The finding headline — SEV_WORD's register, not a marketing line. */
  verdict: string;
  /** Datasets and source count, in the mono machine-fact register. */
  source: string;
}

export interface CardSpec {
  /** Mono label left of the masthead rule, after the wordmark. */
  eyebrow: string;
  /** Mono label at the right end of the masthead. */
  eyebrowRight: string;
  /**
   * The headline, one array entry per line.
   *
   * Broken by hand rather than by wrapping. Left to itself the wrap puts a
   * single word on the second line — "against the / evidence" — which is the
   * difference between a poster and a paragraph that ran out of room. Two lines,
   * roughly balanced, is the shape every variant is written to.
   */
  headline: string[];
  /** The supporting line, broken by hand for the same reason as the headline. */
  lede: string[];
  /** Mono strip across the top of the sheet: what document this is. */
  sheetLabel: string;
  sheetMeta: string;
  /**
   * The one claim on show. Singular on purpose — a second row has to shrink to
   * fit 630px, and a claim at 20px is a grey stripe in a Slack unfurl rather
   * than something anyone reads. One claim, at a size that survives the crop,
   * says everything two would.
   */
  row: ExhibitRow;
  /** The og:image:alt text. Describes the card for anyone who can't see it. */
  alt: string;
}

/**
 * Renders a spec at 1200×630 — the aspect every platform crops from.
 *
 * 1200×630 is the Open Graph recommendation, is what X reads for
 * summary_large_image, and is what LinkedIn, Slack and Discord all accept
 * without re-cropping. The composition keeps the wordmark, the headline's first
 * line and the sheet's severity rails inside the middle band, so the ~1.91:1
 * crops those platforms apply at thumbnail size never cut anything load-bearing.
 */
export async function socialCard(spec: CardSpec) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: PAPER,
          fontFamily: "Public Sans",
          color: INK,
        }}
      >
        {/* The accent rail. Same device as the severity rail on a finding card,
            and the one element that identifies the card at any size. */}
        <div style={{ display: "flex", width: 14, backgroundColor: ACCENT }} />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            padding: "52px 64px 56px 60px",
            /* A wash off the top-right corner, so the paper is lit rather than
               flat. Kept under 8% so it never competes with the sheet. */
            backgroundImage:
              "radial-gradient(1000px 560px at 100% -14%, #d8ebe5, rgba(216,235,229,0))",
          }}
        >
          {/* ------------------------------------------------ masthead -- */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", fontSize: 37, fontWeight: 700, letterSpacing: -1 }}>
              OpenMLR
            </div>
            <div
              style={{
                display: "flex",
                width: 1,
                height: 26,
                backgroundColor: "#d0d5cf",
                margin: "0 20px",
              }}
            />
            <Mono>{spec.eyebrow}</Mono>
            <div style={{ display: "flex", flexGrow: 1 }} />
            <Mono>{spec.eyebrowRight}</Mono>
          </div>
          <div
            style={{ display: "flex", height: 1, backgroundColor: LINE, margin: "20px 0 0 0" }}
          />

          {/* ------------------------------------------------ statement -- */}
          <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
            {spec.headline.map((line) => (
              <div
                key={line}
                style={{
                  display: "flex",
                  fontSize: 66,
                  fontWeight: 700,
                  lineHeight: 1.06,
                  letterSpacing: -2.1,
                }}
              >
                {line}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 20 }}>
            {spec.lede.map((line) => (
              <div
                key={line}
                style={{ display: "flex", fontSize: 25, lineHeight: 1.42, color: INK_2 }}
              >
                {line}
              </div>
            ))}
          </div>

          {/* Pushes the sheet to the bottom edge, so every variant's sheet sits
              on the same baseline however long its headline runs. */}
          <div style={{ display: "flex", flexGrow: 1, minHeight: 26 }} />

          {/* -------------------------------------------------- exhibit -- */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              backgroundColor: SURFACE,
              border: `1px solid ${LINE}`,
              borderRadius: 14,
              /* Clips the rows' square severity rails to the sheet's radius —
                 without it the bottom rail pokes out of the rounded corner. */
              overflow: "hidden",
              boxShadow: "0 1px 2px rgba(22,32,29,0.05), 0 14px 34px rgba(22,32,29,0.07)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "13px 26px",
                borderBottom: `1px solid ${LINE}`,
                backgroundColor: "#fbfaf7",
              }}
            >
              <Mono size={15}>{spec.sheetLabel}</Mono>
              <div style={{ display: "flex", flexGrow: 1 }} />
              <Mono size={15}>{spec.sheetMeta}</Mono>
            </div>
            <ClaimRow row={spec.row} />
          </div>
        </div>
      </div>
    ),
    { ...SIZE, fonts: await fonts() },
  );
}

/* ------------------------------------------------------------- variants -- */

/**
 * Per-route copy.
 *
 * Each variant answers the question the shared link actually raises — a
 * /library link is shared to say "claims get reused", a /research link to say
 * "the slow checks are real research" — and each shows a claim whose verdict
 * belongs to that story. The claims and dataset names are the sample review's
 * (public/sample-review.json), so nothing here is invented.
 */
export const CARDS = {
  home: {
    eyebrow: "MLR pre-check · open source",
    eyebrowRight: "Grounded via Valyu",
    headline: ["Check every claim", "against the evidence"],
    lede: [
      "Every promotional claim, tested against approved labelling,",
      "trial records and the peer-reviewed literature.",
    ],
    sheetLabel: "Promotional asset · 14 claims extracted",
    sheetMeta: "US · HCP",
    row: {
      claimNumber: "4",
      claim: "In a head-to-head trial, OZEMPIC reduced A1C more than dulaglutide.",
      sev: "critical",
      verdict: "Claim not supported by the evidence",
      source: "Drug labels · 12 sources",
    },
    alt: "OpenMLR — check every claim against the evidence. A promotional claim comparing two drugs, marked critical: claim not supported by the evidence, cited to 12 sources in the drug-labels dataset.",
  },

  review: {
    eyebrow: "Claim-by-claim review",
    eyebrowRight: "Every finding cited",
    headline: ["A verdict on every claim,", "with its source attached"],
    lede: [
      "Findings sorted by severity, each carrying the evidence",
      "a reviewer needs to accept or reject it on.",
    ],
    sheetLabel: "Findings · sorted by severity",
    sheetMeta: "3 critical · 6 to review",
    /* A supported claim, where the home card shows a failing one: between them
       the pair says the product returns verdicts, not just red flags. */
    row: {
      claimNumber: "1",
      claim: "OZEMPIC lowers A1C by up to 1.8% in adults with type 2 diabetes.",
      sev: "info",
      verdict: "Supported by the approved label",
      source: "Drug labels · §14.1",
    },
    alt: "OpenMLR review — a verdict on every claim with its source attached. A claim about A1C reduction, marked supported by the approved label and cited to section 14.1 of the drug label.",
  },

  research: {
    eyebrow: "Deep research lane",
    eyebrowRight: "Grounded via Valyu",
    headline: ["Deep research that outlives", "the browser tab"],
    lede: [
      "Surveillance, device and indication checks run as long-form",
      "research against licensed datasets, and finish without you.",
    ],
    sheetLabel: "Deep research · post-market surveillance",
    sheetMeta: "Running · 41 sources",
    row: {
      claimNumber: "9",
      claim: "No new safety signal has emerged since approval.",
      sev: "warning",
      verdict: "Needs post-market surveillance",
      source: "Adverse events · clinical trials",
    },
    alt: "OpenMLR deep research — long-form checks against licensed datasets. A claim about post-market safety signals, flagged as needing post-market surveillance.",
  },

  library: {
    eyebrow: "Claims library",
    eyebrowRight: "Substantiate once",
    headline: ["A claim you have cleared", "stays cleared"],
    lede: [
      "Accepted claims are kept with the evidence that cleared them, so the",
      "next asset reusing a line reuses its substantiation too.",
    ],
    sheetLabel: "Claims library · matched on this asset",
    sheetMeta: "Confirmed · 98% match",
    row: {
      claimNumber: "1",
      claim: "OZEMPIC lowers A1C by up to 1.8% in adults with type 2 diabetes.",
      sev: "info",
      verdict: "Cleared previously — evidence reused",
      source: "Library · confirmed by reviewer",
    },
    alt: "OpenMLR claims library — accepted claims and their evidence are kept and reused. A claim shown as cleared previously, with its evidence reused at a 98% match.",
  },

  history: {
    eyebrow: "Review history",
    eyebrowRight: "Audit trail kept",
    headline: ["Every review, every decision,", "still on the record"],
    lede: [
      "Each run keeps its claims, findings, reviewer decisions and the",
      "datasets it queried — reopenable months later.",
    ],
    sheetLabel: "Review history · 3 runs on this asset",
    sheetMeta: "Reopened · decisions intact",
    row: {
      claimNumber: "4",
      claim: "In a head-to-head trial, OZEMPIC reduced A1C more than dulaglutide.",
      sev: "warning",
      verdict: "Rejected by reviewer — revision requested",
      source: "Audit · 2 decisions recorded",
    },
    alt: "OpenMLR review history — every review, decision and queried dataset stays on the record. A claim shown as rejected by a reviewer with a revision requested.",
  },

  dossier: {
    eyebrow: "Evidence dossier",
    eyebrowRight: "Export as PDF",
    headline: ["The evidence behind a drug,", "in one cited document"],
    lede: [
      "Approved labelling, the trial record and the literature, assembled",
      "into a dossier a reviewer can read, quote and hand on.",
    ],
    sheetLabel: "Evidence dossier · semaglutide",
    sheetMeta: "72 sources · 3 datasets",
    row: {
      claimNumber: "§",
      claim: "Indications, trial record and safety profile, assembled with citations.",
      sev: "info",
      verdict: "Every section cites its source",
      source: "Drug labels · trials · PubMed",
    },
    alt: "OpenMLR evidence dossier — labelling, trials and literature for one drug assembled into a citable document, drawing on 72 sources across three datasets.",
  },
} satisfies Record<string, CardSpec>;
