import postgres from "postgres";
import type { ReviewResult } from "../schemas";
import { embed } from "../llm";

/**
 * Optional Postgres persistence. If DATABASE_URL is unset, everything no-ops and
 * the pipeline still returns full results — Phase 0 runs with or without a DB.
 */

let _sql: ReturnType<typeof postgres> | null = null;
function sql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  _sql = postgres(url);
  return _sql;
}

export async function persistReview(result: ReviewResult): Promise<void> {
  const db = sql();
  if (!db) return; // persistence disabled

  await db`
    INSERT INTO reviews (id, asset_name, drug_name, result)
    VALUES (${result.reviewId}, ${result.assetName}, ${result.drugName}, ${db.json(result as never)})
    ON CONFLICT (id) DO NOTHING
  `;

  if (result.audit.length) {
    await db`
      INSERT INTO audit_entries ${db(
        result.audit.map((a) => ({
          review_id: result.reviewId,
          ts: a.ts,
          step: a.step,
          detail: a.detail,
        })),
      )}
    `;
  }
}

/**
 * F16 — save the review's substantiated claims to the reusable claims library.
 * Only "supported" claims are stored, each with its Valyu-sourced evidence.
 */
export async function saveToLibrary(result: ReviewResult): Promise<number> {
  const db = sql();
  if (!db) return 0;

  const supported = result.claims
    .map((c) => ({ claim: c, s: result.substantiation[c.id] }))
    .filter((x) => x.s && x.s.verification.verdict === "supported");
  if (supported.length === 0) return 0;

  // v2 — embed each supported claim so future reviews can match paraphrases.
  let embeddings: number[][] = [];
  try {
    embeddings = await embed(supported.map((x) => x.claim.text));
  } catch (e) {
    console.error("embed for library failed (falling back to exact-match only):", e);
  }

  const rows = supported.map((x, i) => ({
    review_id: result.reviewId,
    drug_name: result.drugName,
    claim_text: x.claim.text,
    claim_type: x.claim.type,
    verdict: x.s!.verification.verdict,
    confidence: x.s!.verification.confidence,
    evidence: db.json(x.s!.evidence as never),
    embedding: embeddings[i] ? db.json(embeddings[i] as never) : null,
  }));

  await db`
    INSERT INTO claims_library ${db(rows)}
    ON CONFLICT (drug_name, claim_text) DO UPDATE
      SET verdict = EXCLUDED.verdict,
          confidence = EXCLUDED.confidence,
          evidence = EXCLUDED.evidence,
          embedding = EXCLUDED.embedding,
          review_id = EXCLUDED.review_id,
          created_at = now()
  `;
  return rows.length;
}

export interface LibraryEntry {
  drug_name: string;
  claim_text: string;
  claim_type: string;
  verdict: string;
  confidence: number | null;
  evidence: unknown;
  embedding: number[] | null;
  created_at: string;
}

/** List saved library claims, optionally filtered by drug. */
export async function listLibrary(drug?: string): Promise<LibraryEntry[]> {
  const db = sql();
  if (!db) return [];
  const rows = drug
    ? await db<LibraryEntry[]>`
        SELECT drug_name, claim_text, claim_type, verdict, confidence, evidence, embedding, created_at
        FROM claims_library WHERE drug_name ILIKE ${"%" + drug + "%"} ORDER BY created_at DESC LIMIT 200`
    : await db<LibraryEntry[]>`
        SELECT drug_name, claim_text, claim_type, verdict, confidence, evidence, embedding, created_at
        FROM claims_library ORDER BY created_at DESC LIMIT 200`;
  return rows;
}
