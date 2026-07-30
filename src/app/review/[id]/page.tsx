import { Workspace } from "../../Workspace";
import { routeMetadata } from "../../route-metadata";

/**
 * A saved review at its own URL.
 *
 * The whole point of this route: reopening a review from History is a real
 * navigation, so the reviewer can refresh, bookmark, or share the address and
 * land back on the same review. The id is handed to the shared Workspace shell,
 * which fetches it on mount. Everything else — masthead, tabs, DeepResearch —
 * is the same shell as `/`.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  /* Only the canonical URL is per-id. The title and description stay generic on
     purpose: a review holds a client's unapproved promotional copy, and this
     metadata is served to any crawler that follows the link. The static card is
     generic for the same reason. */
  return routeMetadata({
    title: "Review",
    description:
      "A completed MLR review with every extracted claim, verdict, cited evidence and reviewer decision in one place.",
    path: `/review/${id}`,
    image: "https://files.catbox.moe/0nu4r4.png",
    fallbackImage: "/og/review.png",
    imageAlt: "OpenMLR review - a verdict on every claim with its source attached.",
  });
}

export default async function ReviewRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Keyed by id so switching between saved reviews (and to/from home) remounts
  // the shell on the right review instead of reconciling into a stale one.
  return <Workspace key={id} initialReviewId={id} initialView="review" />;
}
