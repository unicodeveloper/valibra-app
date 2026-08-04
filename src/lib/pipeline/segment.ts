import { extractClaims } from "./extract";
import type { Claim, Extraction } from "../schemas";

/**
 * Long-document handling.
 *
 * A paste box quietly assumed short assets. Real MLR work is 20-page detail
 * aids and full DTC pieces, and two things break on those.
 *
 * Extraction is one call over the whole text, so a long document means one
 * enormous prompt: slower, and claim quality falls off in the middle of it.
 * Segmenting gives each pass a readable amount of text.
 *
 * And the per-claim fan-out was an unbounded Promise.all. Fifteen claims is
 * thirty concurrent calls, which is fine; a hundred claims is two hundred, which
 * is how a run ends up with a wall of connection errors. `mapLimit` caps it.
 *
 * What is NOT segmented: fair balance, the boxed-warning guard, and asset
 * classification all judge the piece as a whole. Run per segment, a page of
 * efficacy copy looks unbalanced even when the ISI is three pages later. They
 * keep seeing the entire document.
 */

/** Segment above this size. Corpus assets are 1-2k and work well whole; there is
 *  no reason to disturb the path that is actually measured. */
export const SEGMENT_THRESHOLD = 12_000;

/** Target characters per segment. Comfortably inside a single extraction pass
 *  while still carrying enough context for a claim to be understood. */
const TARGET = 6_000;

/**
 * Split on the strongest boundary available: page breaks first (PDF extraction
 * emits blank lines between pages), then paragraphs, then sentences. Never mid
 * sentence, because half a claim is worse than a claim in the wrong segment.
 *
 * No overlap. Overlap would duplicate claims across segments, and deduplicating
 * paraphrases after the fact is far less reliable than not creating them.
 */
export function segmentAsset(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= SEGMENT_THRESHOLD) return [clean];

  const blocks = clean.split(/\n{2,}/);
  const segments: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) segments.push(current.trim());
    current = "";
  };

  for (const block of blocks) {
    if (block.length > TARGET) {
      // A single block bigger than a segment: break it on sentence ends.
      flush();
      const sentences = block.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if (current.length + s.length > TARGET) flush();
        current += (current ? " " : "") + s;
      }
      flush();
      continue;
    }
    if (current.length + block.length > TARGET) flush();
    current += (current ? "\n\n" : "") + block;
  }
  flush();
  return segments;
}

/**
 * Run `fn` over `items` with at most `limit` in flight.
 *
 * Promise.all starts everything at once. That is fine for a handful of claims
 * and is how a long document turns into a hundred simultaneous requests to two
 * different APIs, which fail as connection errors rather than as anything
 * diagnosable.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Extract claims across a long document.
 *
 * Segments are processed with bounded concurrency, then merged: claims are
 * renumbered (each pass numbers from c1, so ids collide across segments) and
 * de-duplicated, since a running header or a repeated safety line will be picked
 * up in more than one segment.
 *
 * The drug name is taken by majority across segments rather than from the first
 * pass. A single segment can easily be a page that never names the product.
 */
export async function extractAcrossSegments(
  assetText: string,
  onSegment?: (done: number, total: number, claims: number) => void,
): Promise<Extraction & { segments: number }> {
  const segments = segmentAsset(assetText);
  if (segments.length === 1) {
    const one = await extractClaims(assetText);
    return { ...one, segments: 1 };
  }

  let done = 0;
  const results = await mapLimit(segments, 3, async (segment) => {
    const r = await extractClaims(segment);
    done++;
    onSegment?.(done, segments.length, r.claims.length);
    return r;
  });

  const seen = new Set<string>();
  const claims: Claim[] = [];
  const names = new Map<string, number>();

  for (const r of results) {
    if (r.drugName) names.set(r.drugName, (names.get(r.drugName) ?? 0) + 1);
    for (const c of r.claims) {
      const key = c.text.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      claims.push({ ...c, id: `c${claims.length + 1}` });
    }
  }

  const drugName = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return { drugName, claims, segments: segments.length };
}
