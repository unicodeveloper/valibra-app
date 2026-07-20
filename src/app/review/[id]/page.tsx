import type { Metadata } from "next";
import { Workspace } from "../../Workspace";

/**
 * A saved review at its own URL.
 *
 * The whole point of this route: reopening a review from History is a real
 * navigation, so the reviewer can refresh, bookmark, or share the address and
 * land back on the same review. The id is handed to the shared Workspace shell,
 * which fetches it on mount. Everything else — masthead, tabs, DeepResearch —
 * is the same shell as `/`.
 */
export const metadata: Metadata = {
  title: "Review — Valibra",
};

export default async function ReviewRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Workspace initialReviewId={id} initialView="review" />;
}
