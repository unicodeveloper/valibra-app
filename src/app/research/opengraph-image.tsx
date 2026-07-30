import { CARDS, CONTENT_TYPE, SIZE, socialCard } from "@/lib/og/card";

/** Share card for /research — the DeepResearch lane. See src/lib/og/card. */
export const runtime = "nodejs";

export const alt = CARDS.research.alt;
export const size = SIZE;
export const contentType = CONTENT_TYPE;

export default function Image() {
  return socialCard(CARDS.research);
}
