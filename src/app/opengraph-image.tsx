import { ImageResponse } from "next/og";

/**
 * The social-share card, generated at request time (and cached) so it always
 * matches the product without anyone hand-exporting a PNG. Next wires the output
 * into <meta property="og:image"> automatically via this file name; twitter-image
 * re-exports it for the Twitter/X card.
 *
 * Rendered by Satori, which supports a flexbox subset of CSS — every element with
 * more than one child sets `display: flex` explicitly, and no grid/gap-only
 * layouts are used. Colours are the app's own light-theme tokens so the card and
 * the site read as one thing.
 */
export const runtime = "nodejs";

export const alt =
  "Valibra — open-source, Valyu-grounded MLR review. Every promotional claim checked against real biomedical evidence.";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#f5f4f0";
const INK = "#16201d";
const INK_2 = "#55605c";
const INK_3 = "#8b948f";
const ACCENT = "#0d6b5e";
const LINE = "#dcdfd9";

function Chip({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        backgroundColor: "#ffffff",
        border: `1px solid ${LINE}`,
        borderRadius: 999,
        padding: "10px 20px 10px 16px",
        fontSize: 22,
        color: INK_2,
      }}
    >
      <div
        style={{
          display: "flex",
          width: 9,
          height: 9,
          borderRadius: 999,
          backgroundColor: ACCENT,
          marginRight: 12,
        }}
      />
      {label}
    </div>
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 76px",
          backgroundColor: PAPER,
          backgroundImage:
            "radial-gradient(1100px 640px at 92% -12%, #d6eae4, rgba(214,234,228,0))",
          color: INK,
          fontFamily: "sans-serif",
        }}
      >
        {/* Brand row — wordmark and the same tagline the masthead carries. */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 38, fontWeight: 700, letterSpacing: -0.5 }}>
            Valibra
          </div>
          <div
            style={{ display: "flex", width: 1, height: 30, backgroundColor: LINE, margin: "0 22px" }}
          />
          <div
            style={{
              display: "flex",
              fontSize: 21,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: INK_3,
            }}
          >
            Open MLR · powered by Valyu
          </div>
        </div>

        {/* Headline + lede — the product's own first-screen statement. */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 84,
              fontWeight: 700,
              lineHeight: 1.02,
              letterSpacing: -2.6,
              color: INK,
              maxWidth: 940,
            }}
          >
            Check every claim against the evidence
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              lineHeight: 1.45,
              color: INK_2,
              marginTop: 28,
              maxWidth: 880,
            }}
          >
            An open-source, Valyu-grounded MLR pre-check. Every promotional claim is tested against
            approved labelling, trial records and the peer-reviewed literature — and every finding
            cites its source.
          </div>
        </div>

        {/* Trust row — the same factual chips as the site, no adjectives. */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <Chip label="Grounded in licensed evidence" />
          <div style={{ display: "flex", width: 12 }} />
          <Chip label="Every finding cites its source" />
          <div style={{ display: "flex", width: 12 }} />
          <Chip label="Open source · MIT" />
        </div>
      </div>
    ),
    { ...size },
  );
}
