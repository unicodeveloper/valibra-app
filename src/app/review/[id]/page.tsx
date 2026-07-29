import { Workspace } from "../../Workspace";

const DESCRIPTION =
  "Open-source, Valyu-grounded MLR review. Every promotional claim checked against real biomedical evidence — every finding cited.";

const SOCIAL_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "OpenMLR — open-source, Valyu-grounded MLR review. Every promotional claim checked against real biomedical evidence.",
  type: "image/png",
};

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
  const reviewPath = `/review/${id}`;

  return {
    title: "Review",
    alternates: { canonical: reviewPath },
    openGraph: {
      type: "website",
      siteName: "OpenMLR",
      title: "OpenMLR review",
      description: DESCRIPTION,
      url: reviewPath,
      locale: "en_US",
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: "OpenMLR review",
      description: DESCRIPTION,
      images: [SOCIAL_IMAGE],
    },
  };
}

export default async function ReviewRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Keyed by id so switching between saved reviews (and to/from home) remounts
  // the shell on the right review instead of reconciling into a stale one.
  return <Workspace key={id} initialReviewId={id} initialView="review" />;
}
