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
 * Each route points to a hosted social image first, then a local static fallback
 * in /public/og if the hosted copy is unavailable.
 */
export function routeMetadata({
  title,
  description,
  path,
  image,
  fallbackImage,
  imageAlt,
}: {
  /** Slots into the "%s · OpenMLR" template from the root layout. */
  title: string;
  description: string;
  /** Root-relative, e.g. "/library". Resolved against metadataBase. */
  path: string;
  /** Primary URL to a static 1200x630 social card. */
  image?: string;
  /** Local fallback path to a static 1200x630 social card. */
  fallbackImage?: string;
  /** Describes the card for anyone who can't see it. */
  imageAlt?: string;
}): Metadata {
  const fullTitle = `${title} · OpenMLR`;
  const socialImages = [
    {
      url: image ?? "https://files.catbox.moe/h9i6us.png",
      width: 1200,
      height: 630,
      alt: imageAlt ?? fullTitle,
    },
    {
      url: fallbackImage ?? "/og/openmlr.png",
      width: 1200,
      height: 630,
      alt: imageAlt ?? fullTitle,
    },
  ];

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
      images: socialImages,
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: socialImages,
    },
  };
}
