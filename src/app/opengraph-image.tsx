import { CARDS, CONTENT_TYPE, SIZE, socialCard } from "@/lib/og/card";

/**
 * The share card for the landing page, generated at request time (and cached) so
 * it always matches the product without anyone hand-exporting a PNG. Next wires
 * the output into <meta property="og:image"> from this file name alone;
 * twitter-image.tsx re-exports it for the X card.
 *
 * The design, the palette and the copy for every variant live in src/lib/og/card.
 * As the root-level image this one also stands in for any route that doesn't
 * define its own, so it carries the product's plainest statement.
 */
export const runtime = "nodejs";

export const alt = CARDS.home.alt;
export const size = SIZE;
export const contentType = CONTENT_TYPE;

export default function Image() {
  return socialCard(CARDS.home);
}
