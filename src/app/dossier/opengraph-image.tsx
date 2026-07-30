import { CARDS, CONTENT_TYPE, SIZE, socialCard } from "@/lib/og/card";

/** Share card for /dossier — the evidence dossier. See src/lib/og/card. */
export const runtime = "nodejs";

export const alt = CARDS.dossier.alt;
export const size = SIZE;
export const contentType = CONTENT_TYPE;

export default function Image() {
  return socialCard(CARDS.dossier);
}
