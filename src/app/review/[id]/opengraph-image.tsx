import { CARDS, CONTENT_TYPE, SIZE, socialCard } from "@/lib/og/card";

/**
 * Share card for a saved review.
 *
 * Deliberately generic: the id in the URL is the only thing this route knows,
 * and a review's claims are a client's unapproved promotional copy. Rendering
 * them into an image that crawlers fetch, cache and republish would leak the
 * asset to anyone the link reached. So the card describes the *shape* of a
 * review — verdict, severity, citation — using the public sample's claims.
 */
export const runtime = "nodejs";

export const alt = CARDS.review.alt;
export const size = SIZE;
export const contentType = CONTENT_TYPE;

export default function Image() {
  return socialCard(CARDS.review);
}
