/**
 * The Twitter/X card reuses the exact same generated image as Open Graph. Next
 * reads these named exports from this file to emit <meta name="twitter:image">,
 * so there is one source of truth for the social card.
 */
export { default, alt, size, contentType, runtime } from "./opengraph-image";
