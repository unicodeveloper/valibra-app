import { randomUUID } from "node:crypto";
import { sql, type Owner } from "./db/client";
import { embed, cosineSim } from "./llm";
import type { Evidence } from "./schemas";

/**
 * Reference packs — the reviewer's own approved source documents.
 *
 * Retrieval reaches licensed datasets, and a residual slice of claims still
 * comes back with no source at all, concentrated on newer specialised products
 * where review matters most. But the reviewer usually *has* the reference: the
 * asset was written from an approved PI, a pivotal manuscript, a data-on-file
 * memo. This lets them supply it, so "no source found" becomes "supported by
 * your reference, page N".
 *
 * Deliberately NOT called a dossier. In this app a dossier is the
 * DeepResearch-generated report about a drug, which is the opposite direction
 * of travel.
 *
 * Scope note: reference chunks only ever feed CLAIM SUBSTANTIATION. The label,
 * FAERS, interaction and patent checks stay on live retrieval, always. A
 * reviewer uploading last year's PI must never be able to shift what the
 * off-label detector believes the approved indication is.
 */

/** Chunk size in characters. Large enough to carry a whole claim's context,
 *  small enough that the cited passage is actually findable inside it. */
const CHUNK = 1400;
const OVERLAP = 200;

/**
 * Cosine floor for treating a chunk as relevant to a claim.
 *
 * MEASURED, not guessed. The first version used 0.62, reasoned from the 0.85
 * the claims library uses for paraphrase matching. That was wrong: 0.85 compares
 * two claims, which are the same kind of short assertion, while this compares a
 * claim to a prose passage and scores far lower for the same relatedness.
 * Against a real data-on-file memo, claims the memo demonstrably substantiates
 * scored 0.39 to 0.62 — so 0.62 sat at the very top of the true range and the
 * pack fired only for the single best match, intermittently, because that match
 * landed exactly on the boundary.
 *
 * Set low deliberately, with k kept small. A cosine score is a poor judge of
 * whether a passage bears on a claim; the verifier reads the passage and is a
 * much better one. The floor's job is only to keep obvious junk out of the
 * evidence block, not to decide relevance.
 */
const RELEVANCE = 0.35;

/**
 * Split on paragraph boundaries where possible, falling back to hard slices.
 * Overlap keeps a sentence that straddles a boundary retrievable from both
 * sides rather than lost between them.
 */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= CHUNK) return clean ? [clean] : [];

  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + CHUNK, clean.length);
    if (end < clean.length) {
      // Prefer a paragraph break, then a sentence end, in the last third.
      const window = clean.slice(i + Math.floor(CHUNK * 0.66), end);
      const para = window.lastIndexOf("\n\n");
      const stop = window.search(/\.[^.]*$/);
      const rel = para >= 0 ? para : stop;
      if (rel > 0) end = i + Math.floor(CHUNK * 0.66) + rel + 1;
    }
    const piece = clean.slice(i, end).trim();
    if (piece) out.push(piece);
    if (end >= clean.length) break;
    i = Math.max(end - OVERLAP, i + 1);
  }
  return out;
}

export interface PackSummary {
  id: string;
  name: string;
  drugName: string | null;
  docCount: number;
  chunkCount: number;
  createdAt: string;
}

/** Create an empty pack. Returns its id. */
export async function createPack(
  name: string,
  drugName: string | null,
  owner: Owner,
): Promise<string> {
  const db = sql();
  if (!db) throw new Error("Reference packs need a database. Set DATABASE_URL.");
  const id = randomUUID();
  await db`
    INSERT INTO reference_packs (id, owner, name, drug_name)
    VALUES (${id}, ${owner?.sub ?? null}, ${name}, ${drugName})
  `;
  return id;
}

/**
 * Add a document to a pack: chunk it, embed the chunks, store both.
 *
 * Embedding failure is not fatal — the document is still stored, its chunks
 * simply cannot be matched semantically. Losing the upload entirely because one
 * API call failed would be the worse outcome.
 */
export async function addDocument(
  packId: string,
  filename: string,
  mime: string,
  text: string,
): Promise<{ docId: string; chunks: number }> {
  const db = sql();
  if (!db) throw new Error("Reference packs need a database. Set DATABASE_URL.");
  const chunks = chunkText(text);
  const docId = randomUUID();

  await db`
    INSERT INTO reference_docs (id, pack_id, filename, mime, char_count)
    VALUES (${docId}, ${packId}, ${filename}, ${mime}, ${text.length})
  `;
  if (chunks.length === 0) return { docId, chunks: 0 };

  let vectors: number[][] = [];
  try {
    vectors = await embed(chunks);
  } catch (e) {
    console.error("reference chunk embedding failed (stored unmatched):", e);
  }

  const rows = chunks.map((t, i) => ({
    id: randomUUID(),
    doc_id: docId,
    pack_id: packId,
    ordinal: i,
    text: t,
    embedding: vectors[i] ? db.json(vectors[i] as never) : null,
  }));
  await db`INSERT INTO reference_chunks ${db(rows, "id", "doc_id", "pack_id", "ordinal", "text", "embedding")}`;

  return { docId, chunks: chunks.length };
}

/** Packs available to this owner, newest first. */
export async function listPacks(owner: Owner): Promise<PackSummary[]> {
  const db = sql();
  if (!db) return [];
  const rows = await db<
    { id: string; name: string; drug_name: string | null; docs: string; chunks: string; created_at: Date }[]
  >`
    SELECT p.id, p.name, p.drug_name, p.created_at,
           COUNT(DISTINCT d.id) AS docs,
           COUNT(c.id)          AS chunks
    FROM reference_packs p
    LEFT JOIN reference_docs   d ON d.pack_id = p.id
    LEFT JOIN reference_chunks c ON c.pack_id = p.id
    WHERE p.owner IS NOT DISTINCT FROM ${owner?.sub ?? null}
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    drugName: r.drug_name,
    docCount: Number(r.docs),
    chunkCount: Number(r.chunks),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/**
 * Find passages in a pack that bear on a claim.
 *
 * Returns Evidence so it drops straight into the existing verification path,
 * but tagged `reference:<filename>` so nothing downstream can mistake the
 * reviewer's own document for licensed primary literature. That distinction has
 * to survive all the way to the finding: "your reference says this" and "the
 * literature says this" are different assurances.
 */
export async function searchPack(
  packId: string,
  claimText: string,
  k = 3,
): Promise<Evidence[]> {
  const db = sql();
  if (!db || !packId || !claimText.trim()) return [];

  const rows = await db<
    { text: string; ordinal: number; embedding: number[] | null; filename: string }[]
  >`
    SELECT c.text, c.ordinal, c.embedding, d.filename
    FROM reference_chunks c
    JOIN reference_docs d ON d.id = c.doc_id
    WHERE c.pack_id = ${packId} AND c.embedding IS NOT NULL
  `;
  if (rows.length === 0) return [];

  let query: number[];
  try {
    [query] = await embed([claimText]);
  } catch (e) {
    console.error("reference search embedding failed:", e);
    return [];
  }

  return rows
    .map((r) => ({ r, score: cosineSim(query, r.embedding as number[]) }))
    .filter((x) => x.score >= RELEVANCE)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ r, score }) => ({
      source: `reference:${r.filename}`,
      title: `${r.filename} (part ${r.ordinal + 1})`,
      url: "",
      snippet: r.text,
      publicationDate: null,
      citationCount: null,
      // Surfaced in the UI so a reviewer can see how close the match actually was.
      relevance: Number(score.toFixed(3)),
    }));
}

/**
 * Delete a pack and everything under it. Owner-scoped in the WHERE clause, not
 * checked separately first: a caller must never be able to delete another
 * tenant's pack by guessing its id, and doing the check in the statement leaves
 * no window between the check and the delete.
 */
export async function deletePack(packId: string, owner: Owner): Promise<boolean> {
  const db = sql();
  if (!db) return false;
  const rows = await db`
    DELETE FROM reference_packs
    WHERE id = ${packId} AND owner IS NOT DISTINCT FROM ${owner?.sub ?? null}
    RETURNING id
  `;
  return rows.length > 0;
}
