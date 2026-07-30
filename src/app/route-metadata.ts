import type { Metadata } from "next";

/**
 * One shape for every tab's metadata.
 *
 * The four tabs are the same shell at four addresses, and each is a link someone
 * pastes into Slack. Without this they inherited the landing page's title and
 * description, so a shared /library link claimed to be the compose screen. Each
 * route now states what it is, once, and the rest of the shape — canonical URL,
 * Open Graph, X card — is derived rather than copy-pasted four times.
 *
 * Deliberately not set here: images. Each route has its own opengraph-image.tsx
 * and twitter-image.tsx, and Next's file conventions fill in og:image and its
 * width/height/type/alt siblings. Naming an image in this object would replace
 * the route's own card with whatever was named.
 */
export function routeMetadata({
  title,
  description,
  path,
}: {
  /** Slots into the "%s · OpenMLR" template from the root layout. */
  title: string;
  description: string;
  /** Root-relative, e.g. "/library". Resolved against metadataBase. */
  path: string;
}): Metadata {
  const fullTitle = `${title} · OpenMLR`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "OpenMLR",
      title: fullTitle,
      description,
      url: path,
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
    },
  };
}
