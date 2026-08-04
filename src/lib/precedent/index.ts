import { embed, cosineSim } from "../llm";
import { chunkText } from "../references";
import type { Evidence } from "../schemas";
import corpus from "./opdp-letters.json";

/**
 * Seeded OPDP enforcement-precedent library.
 *
 * Every OPDP untitled letter issued this year, shipped with the app so a
 * reviewer has real enforcement precedent on first login rather than an empty
 * shelf. Refreshed by scripts/fetch-opdp-letters.mjs.
 *
 * THIS IS NOT SUBSTANTIATION, and is deliberately kept out of the reference-pack
 * path that feeds claim verification. An OPDP letter quotes the offending claim
 * verbatim, so it is the single best semantic match for that claim in any
 * corpus — put it in the substantiation lane and a letter saying "this claim is
 * misleading" becomes retrievable as evidence FOR the claim. It feeds F9
 * (regulatory grounding) only, where the question is "has FDA objected to
 * something like this", which is what a letter can actually answer.
 *
 * Scoped to the current year on purpose. OPDP issued five enforcement letters in
 * each of 2023 and 2024, then close to a hundred in a single week of September
 * 2025; FDA's own index carried 21 untitled letters for Jan-Jul 2026 when this
 * was written, roughly three a month.
 *
 * The rate is not the main reason though. FDA's positions have moved. A 2026
 * letter objected to a factual comparison of approved indications, the same kind
 * of claim FDA expressly permitted in a 2005 Zyrtec warning letter ("No other
 * antihistamine is approved to treat more allergies than Zyrtec"). Seeding older
 * letters as precedent risks teaching a position the agency has since abandoned,
 * which is worse than seeding none.
 *
 * FDA letters are US Government works, public domain under 17 USC 105.
 */

interface Letter {
  date: string;
  company: string;
  product: string;
  url: string;
  text: string;
}

interface Chunk {
  letter: Letter;
  ordinal: number;
  text: string;
}

/** Same floor as reference packs, measured rather than guessed. */
const RELEVANCE = 0.35;

let chunks: Chunk[] | null = null;
let vectors: number[][] | null = null;
let embedding: Promise<void> | null = null;

function buildChunks(): Chunk[] {
  if (chunks) return chunks;
  chunks = [];
  for (const letter of corpus.letters as Letter[]) {
    chunkText(letter.text).forEach((text, ordinal) => {
      chunks!.push({ letter, ordinal, text });
    });
  }
  return chunks;
}

/**
 * Embed the corpus once per process, on first use rather than at boot.
 *
 * Shipping precomputed vectors would add megabytes of float JSON to the repo for
 * data that is regenerated whenever the corpus is refreshed. Embedding lazily
 * costs one batched call the first time precedent is needed and nothing
 * afterwards, and a review that never raises a concern never pays it at all.
 */
async function ensureEmbedded(): Promise<void> {
  if (vectors) return;
  if (!embedding) {
    embedding = (async () => {
      const cs = buildChunks();
      vectors = await embed(cs.map((c) => c.text));
    })().catch((e) => {
      // Reset so a transient failure doesn't poison the process: precedent is
      // an enhancement, and F9 still has its live web search.
      embedding = null;
      throw e;
    });
  }
  await embedding;
}

/** How many letters and from when, for the UI and the audit trail. */
export function precedentSummary() {
  const letters = corpus.letters as Letter[];
  return {
    year: corpus.year,
    count: letters.length,
    fetchedAt: corpus.fetchedAt,
    source: corpus.source,
    newest: letters[0]?.date ?? null,
    oldest: letters[letters.length - 1]?.date ?? null,
    letters: letters.map((l) => ({
      date: l.date,
      company: l.company,
      product: l.product,
      url: l.url,
    })),
  };
}

/**
 * Passages from this year's OPDP letters that bear on a review's concerns.
 *
 * Returns Evidence tagged `opdp-precedent` so it is never confused with either
 * retrieved literature or a reviewer's own documents.
 */
export async function searchPrecedent(concerns: string[], k = 5): Promise<Evidence[]> {
  const query = concerns.join("; ").trim();
  if (!query) return [];

  try {
    await ensureEmbedded();
    const [q] = await embed([query]);
    const cs = buildChunks();
    return cs
      .map((c, i) => ({ c, score: cosineSim(q, vectors![i]) }))
      .filter((x) => x.score >= RELEVANCE)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ c, score }) => ({
        source: "opdp-precedent",
        title: `OPDP untitled letter, ${c.letter.date} — ${c.letter.product}`,
        url: c.letter.url,
        snippet: c.text,
        publicationDate: c.letter.date,
        citationCount: null,
        relevance: Number(score.toFixed(3)),
      }));
  } catch (e) {
    // Never fatal: F9 keeps its live web search, which is also what covers
    // letters issued since this corpus was last refreshed.
    console.error("precedent search failed (live search only):", e);
    return [];
  }
}
