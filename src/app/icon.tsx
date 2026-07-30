import { ImageResponse } from "next/og";

/**
 * The app mark, at the three sizes that actually get used.
 *
 * A check on the brand green: the product's whole promise is a verdict on a
 * claim, and ✓ is the glyph the app already uses for "supported" (SEV_GLYPH in
 * review-model.ts). It is drawn as a path rather than typed, because these
 * images are rasterised without a font.
 *
 * generateImageMetadata gives one file three outputs, each served at /icon/<id>:
 *
 *   32   the tab favicon — the mark at its smallest legible size
 *   192  the Android home-screen icon named by manifest.ts
 *   512  the maskable icon. Android crops maskable icons to whatever shape the
 *        launcher uses, so this one is full-bleed with the mark inside the 80%
 *        safe zone; the other two keep the rounded-square silhouette.
 */
export const runtime = "nodejs";

const ACCENT = "#0d6b5e";
const PAPER = "#f5f4f0";

export function generateImageMetadata() {
  return [
    { id: "32", size: { width: 32, height: 32 }, contentType: "image/png" },
    { id: "192", size: { width: 192, height: 192 }, contentType: "image/png" },
    { id: "512", size: { width: 512, height: 512 }, contentType: "image/png" },
  ];
}

export default function Icon({ id }: { id: string }) {
  const px = Number(id);
  const maskable = px === 512;

  /* The check occupies 46% of a maskable icon (inside Android's safe circle) and
     58% of a normal one, where the whole square is visible. */
  const inner = Math.round(px * (maskable ? 0.46 : 0.58));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: ACCENT,
          /* Squircle at the sizes where the silhouette shows; square when the
             launcher is going to impose its own shape anyway. */
          borderRadius: maskable ? 0 : Math.round(px * 0.22),
        }}
      >
        <svg width={inner} height={inner} viewBox="0 0 24 24">
          <path
            d="M3.5 12.6 L9.4 18.5 L20.5 5.8"
            fill="none"
            stroke={PAPER}
            /* Heavier at 32px: a hairline check disappears in a tab strip. */
            strokeWidth={px <= 32 ? 3.6 : 2.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { width: px, height: px },
  );
}
