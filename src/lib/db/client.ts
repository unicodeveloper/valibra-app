import postgres from "postgres";
import type { ReviewResult } from "../schemas";
import type { ValyuIdentity } from "../valyu-credentials";
import { embed } from "../llm";

/**
 * Optional Postgres persistence. If DATABASE_URL is unset, everything no-ops and
 * the pipeline still returns full results — the app runs with or without a DB.
 *
 * Every read and write is scoped by `owner`: the signed-in reviewer's identity
 * in valyu mode, or `null` in self-hosted mode. NULL owner means "the single
 * global tenant", and `IS NOT DISTINCT FROM` gives null-safe equality so one
 * query serves both — a valyu request sees only its own rows, a self-hosted
 * request sees the unowned global rows. Owner is always resolved server-side
 * from the token (see currentIdentity), never trusted from the client.
 */

export type DecisionValue = "accepted" | "rejected" | "cleared";

/** Who a persisted row belongs to; null in self-hosted mode (global tenant). */
export type Owner = ValyuIdentity | null;

let _sql: ReturnType<typeof postgres> | null = null;
function sql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) return null;

  // TLS handling for managed Postgres (Railway, Neon, Supabase, …). A local dev
  // DB and Railway's *private* network (`*.railway.internal`) speak plaintext;
  // a public/proxy host needs TLS, and managed providers use certs that don't
  // chain to a system root, so we require TLS without CA verification there.
  // Explicit `sslmode` in the URL always wins.
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(url);
  const internal = /\.railway\.internal[:/]/i.test(url);
  const sslInUrl = /[?&]sslmode=/i.test(url);
  const ssl = !sslInUrl && !local && !internal ? { rejectUnauthorized: false } : undefined;

  _sql = postgres(url, ssl ? { ssl } : {});
  return _sql;
}

export async function persistReview(result: ReviewResult, owner: Owner): Promise<void> {
  const db = sql();
  if (!db) return; // persistence disabled

  await db`
    INSERT INTO reviews (id, asset_name, drug_name, result, owner_sub, owner_email)
    VALUES (
      ${result.reviewId}, ${result.assetName}, ${result.drugName}, ${db.json(result as never)},
      ${owner?.sub ?? null}, ${owner?.email ?? null}
    )
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
export async function saveToLibrary(result: ReviewResult, owner: Owner): Promise<number> {
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
    owner_sub: owner?.sub ?? null,
  }));

  // Conflict target is the owner-scoped unique index (COALESCE(owner_sub,''),
  // drug_name, claim_text) — the same claim under a different account is a
  // distinct row, not an overwrite.
  // status is deliberately absent from the UPDATE set: a re-run must not demote a
  // claim a reviewer already confirmed, nor resurrect one they rejected.
  await db`
    INSERT INTO claims_library ${db(rows)}
    ON CONFLICT (COALESCE(owner_sub, ''), drug_name, claim_text) DO UPDATE
      SET verdict = EXCLUDED.verdict,
          confidence = EXCLUDED.confidence,
          evidence = EXCLUDED.evidence,
          embedding = EXCLUDED.embedding,
          review_id = EXCLUDED.review_id,
          created_at = now()
  `;
  return rows.length;
}

/* --------------------------- reviewer decisions --------------------------- */

/**
 * Record one accept/reject/clear on a finding. Append-only — the decision
 * history is the audit trail, so nothing here updates or deletes a prior row.
 *
 * Three things happen together: the decision row, a matching audit entry (so a
 * persisted review's trail covers the human steps too, not just the pipeline),
 * and — for a substantiation finding — promotion or demotion of the claim's
 * library entry, so reuse follows the reviewer rather than the model.
 */
export async function recordDecision(
  reviewId: string,
  findingId: string,
  decision: DecisionValue,
  reviewer: string,
  owner: Owner,
): Promise<{ persisted: boolean; libraryStatus: string | null }> {
  const db = sql();
  if (!db) return { persisted: false, libraryStatus: null };

  // Ownership check and existence check in one: a review that isn't the
  // caller's is indistinguishable from one that doesn't exist — never confirm
  // another account's review exists, and never let a decision land on it.
  const rows = await db<{ exists: boolean }[]>`
    SELECT true AS exists FROM reviews
    WHERE id = ${reviewId} AND owner_sub IS NOT DISTINCT FROM ${owner?.sub ?? null}
  `;
  if (rows.length === 0) throw new Error(`Unknown review ${reviewId}`);

  // In valyu mode the reviewer is the authenticated account, not a typed name:
  // a compliance audit trail must attribute a decision to a verified identity.
  const who = owner?.email || reviewer;

  await db`
    INSERT INTO finding_decisions (review_id, finding_id, decision, reviewer)
    VALUES (${reviewId}, ${findingId}, ${decision}, ${who})
  `;

  await db`
    INSERT INTO audit_entries (review_id, ts, step, detail)
    VALUES (${reviewId}, now(), 'decision',
            ${`Finding ${findingId} ${decision}${who ? ` by ${who}` : ""}.`})
  `;

  const libraryStatus = await syncLibraryStatus(reviewId, findingId, decision, owner);
  return { persisted: true, libraryStatus };
}

/**
 * A decision on a substantiation finding is a judgement on the claim itself, so
 * carry it into the library: accepted → confirmed, rejected → rejected (never
 * reused again), cleared → back to provisional. Findings in other categories
 * (fair balance, off-label, …) concern the asset, not a reusable claim, and
 * leave the library alone.
 */
async function syncLibraryStatus(
  reviewId: string,
  findingId: string,
  decision: DecisionValue,
  owner: Owner,
): Promise<string | null> {
  const db = sql();
  if (!db) return null;

  const [row] = await db<{ result: ReviewResult }[]>`
    SELECT result FROM reviews
    WHERE id = ${reviewId} AND owner_sub IS NOT DISTINCT FROM ${owner?.sub ?? null}
  `;
  if (!row) return null;

  const result = row.result;
  const finding = result.findings.find((f) => f.id === findingId);
  if (!finding || finding.category !== "substantiation" || !finding.claimId) return null;

  const claim = result.claims.find((c) => c.id === finding.claimId);
  if (!claim) return null;

  const status =
    decision === "accepted" ? "confirmed" : decision === "rejected" ? "rejected" : "provisional";

  await db`
    UPDATE claims_library
       SET status = ${status},
           reviewed_at = ${decision === "cleared" ? null : new Date()}
     WHERE drug_name = ${result.drugName} AND claim_text = ${claim.text}
       AND owner_sub IS NOT DISTINCT FROM ${owner?.sub ?? null}
  `;
  return status;
}

/** Current decision per finding for a review — the newest row wins. Scoped to
 *  the owner via the parent review, so decisions on another account's review
 *  never surface. */
export async function getDecisions(
  reviewId: string,
  owner: Owner,
): Promise<Record<string, DecisionValue>> {
  const db = sql();
  if (!db) return {};
  const rows = await db<{ finding_id: string; decision: DecisionValue }[]>`
    SELECT DISTINCT ON (fd.finding_id) fd.finding_id, fd.decision
    FROM finding_decisions fd
    JOIN reviews r ON r.id = fd.review_id
    WHERE fd.review_id = ${reviewId}
      AND r.owner_sub IS NOT DISTINCT FROM ${owner?.sub ?? null}
    ORDER BY fd.finding_id, fd.decided_at DESC, fd.id DESC
  `;
  const out: Record<string, DecisionValue> = {};
  for (const r of rows) if (r.decision !== "cleared") out[r.finding_id] = r.decision;
  return out;
}

export interface ReviewSummary {
  id: string;
  asset_name: string;
  drug_name: string;
  created_at: string;
  finding_count: number;
  decided_count: number;
}

/** Past reviews, newest first — the history list, scoped to the owner. */
export async function listReviews(owner: Owner, limit = 50): Promise<ReviewSummary[]> {
  const db = sql();
  if (!db) return [];
  return db<ReviewSummary[]>`
    SELECT r.id,
           r.asset_name,
           r.drug_name,
           r.created_at,
           COALESCE(jsonb_array_length(r.result -> 'findings'), 0) AS finding_count,
           -- ::int because postgres.js hands back a bigint COUNT as a string.
           (SELECT COUNT(*)::int FROM (
              SELECT DISTINCT ON (finding_id) decision
              FROM finding_decisions d
              WHERE d.review_id = r.id
              ORDER BY finding_id, decided_at DESC, id DESC
            ) latest WHERE latest.decision <> 'cleared') AS decided_count
    FROM reviews r
    WHERE r.owner_sub IS NOT DISTINCT FROM ${owner?.sub ?? null}
    ORDER BY r.created_at DESC
    LIMIT ${limit}
  `;
}

/** Reopen a past review: the stored result plus the decisions made on it.
 *  Returns null (→404) for a review that isn't the owner's, so a guessed UUID
 *  can't read another account's asset. */
export async function getReview(
  id: string,
  owner: Owner,
): Promise<{ result: ReviewResult; decisions: Record<string, DecisionValue> } | null> {
  const db = sql();
  if (!db) return null;
  const [row] = await db<{ result: ReviewResult }[]>`
    SELECT result FROM reviews
    WHERE id = ${id} AND owner_sub IS NOT DISTINCT FROM ${owner?.sub ?? null}
  `;
  if (!row) return null;
  return { result: row.result, decisions: await getDecisions(id, owner) };
}

export interface LibraryEntry {
  drug_name: string;
  claim_text: string;
  claim_type: string;
  verdict: string;
  confidence: number | null;
  evidence: unknown;
  embedding: number[] | null;
  status: "provisional" | "confirmed" | "rejected";
  created_at: string;
}

/** List saved library claims for the owner, optionally filtered by drug. */
export async function listLibrary(drug: string | undefined, owner: Owner): Promise<LibraryEntry[]> {
  const db = sql();
  if (!db) return [];
  const rows = drug
    ? await db<LibraryEntry[]>`
        SELECT drug_name, claim_text, claim_type, verdict, confidence, evidence, embedding, status, created_at
        FROM claims_library
        WHERE drug_name ILIKE ${"%" + drug + "%"}
          AND owner_sub IS NOT DISTINCT FROM ${owner?.sub ?? null}
        ORDER BY created_at DESC LIMIT 200`
    : await db<LibraryEntry[]>`
        SELECT drug_name, claim_text, claim_type, verdict, confidence, evidence, embedding, status, created_at
        FROM claims_library
        WHERE owner_sub IS NOT DISTINCT FROM ${owner?.sub ?? null}
        ORDER BY created_at DESC LIMIT 200`;
  return rows;
}
