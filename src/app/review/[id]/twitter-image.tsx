/**
 * The X card reuses the exact same generated image as Open Graph — Next reads
 * these named exports to emit <meta name="twitter:image">, so there is one
 * source of truth per route.
 */
export { default, alt, size, contentType } from "./opengraph-image";

export const runtime = "nodejs";
