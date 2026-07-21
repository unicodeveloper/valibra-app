-- Audit + review persistence. Run: npm run db:init (needs DATABASE_URL).
-- Persistence is optional; the pipeline returns full results either way.

CREATE TABLE IF NOT EXISTS reviews (
  id           UUID PRIMARY KEY,
  asset_name   TEXT        NOT NULL,
  drug_name    TEXT        NOT NULL DEFAULT '',
  result       JSONB       NOT NULL,
  -- Who owns this review, in valyu mode: the signed-in reviewer's OIDC subject
  -- (and email, for the audit trail). NULL in self-hosted mode — that deployment
  -- is a single tenant, so its rows are unowned and globally visible.
  owner_sub    TEXT,
  owner_email  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The audit trail is denormalized for immutable, queryable review history.
CREATE TABLE IF NOT EXISTS audit_entries (
  id          BIGSERIAL PRIMARY KEY,
  review_id   UUID        NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  ts          TIMESTAMPTZ NOT NULL,
  step        TEXT        NOT NULL,
  detail      TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_review ON audit_entries(review_id);
CREATE INDEX IF NOT EXISTS idx_reviews_created ON reviews(created_at DESC);

-- Reviewer decisions on findings. Append-only: a reviewer changing their mind is
-- itself part of the record, so we never update or delete a row here. Current
-- state is the newest row per finding. Un-deciding (toggling a decision off)
-- records as 'cleared' rather than deleting the history.
CREATE TABLE IF NOT EXISTS finding_decisions (
  id          BIGSERIAL PRIMARY KEY,
  review_id   UUID        NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  finding_id  TEXT        NOT NULL,
  decision    TEXT        NOT NULL CHECK (decision IN ('accepted', 'rejected', 'cleared')),
  reviewer    TEXT        NOT NULL DEFAULT '',
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decisions_review ON finding_decisions(review_id, decided_at DESC);

-- F16 — optional, exportable claims library. Substantiated claims get saved here
-- for reuse across assets, each carrying its Valyu-sourced evidence.
CREATE TABLE IF NOT EXISTS claims_library (
  id           BIGSERIAL PRIMARY KEY,
  review_id    UUID        REFERENCES reviews(id) ON DELETE SET NULL,
  drug_name    TEXT        NOT NULL DEFAULT '',
  claim_text   TEXT        NOT NULL,
  claim_type   TEXT        NOT NULL DEFAULT '',
  verdict      TEXT        NOT NULL,
  confidence   REAL,
  evidence     JSONB       NOT NULL DEFAULT '[]',
  embedding    JSONB,      -- v2 semantic matching (OpenAI embedding vector)
  -- Owner of this library entry, in valyu mode (NULL = self-hosted global).
  -- Reuse is per-account: your paraphrase matches only your prior claims.
  owner_sub    TEXT,
  -- provisional = the pipeline substantiated it, no human has looked yet.
  -- confirmed   = a reviewer accepted the substantiation finding.
  -- rejected    = a reviewer disagreed; never reused, never matched.
  status       TEXT        NOT NULL DEFAULT 'provisional'
                           CHECK (status IN ('provisional', 'confirmed', 'rejected')),
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  -- Uniqueness is scoped by owner via a unique index below, not an inline
  -- constraint — the same (drug, claim) may exist once per account.
);
CREATE INDEX IF NOT EXISTS idx_library_drug ON claims_library(drug_name);
-- Upgrade existing installs that predate these columns.
ALTER TABLE claims_library ADD COLUMN IF NOT EXISTS embedding JSONB;
ALTER TABLE claims_library ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'provisional';
ALTER TABLE claims_library ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Per-account scoping (additive columns; NULL on existing rows = self-hosted global).
ALTER TABLE reviews        ADD COLUMN IF NOT EXISTS owner_sub   TEXT;
ALTER TABLE reviews        ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE claims_library ADD COLUMN IF NOT EXISTS owner_sub   TEXT;
CREATE INDEX IF NOT EXISTS idx_reviews_owner ON reviews(owner_sub);
CREATE INDEX IF NOT EXISTS idx_library_owner ON claims_library(owner_sub);

-- Re-scope library uniqueness from (drug, claim) to (owner, drug, claim).
-- Transforming, so guarded: drop the old unscoped constraint if it's still
-- present, then create the owner-scoped unique index. COALESCE(owner_sub,'')
-- keeps NULL owners (self-hosted) colliding as one tenant, since a plain unique
-- index treats every NULL as distinct and would let duplicates through there.
ALTER TABLE claims_library DROP CONSTRAINT IF EXISTS claims_library_drug_name_claim_text_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_library_owner_drug_claim
  ON claims_library (COALESCE(owner_sub, ''), drug_name, claim_text);
-- ADD COLUMN can't carry the CHECK on an upgrade, so attach it separately
-- (Postgres has no ADD CONSTRAINT IF NOT EXISTS).
DO $$
BEGIN
  ALTER TABLE claims_library ADD CONSTRAINT claims_library_status_check
    CHECK (status IN ('provisional', 'confirmed', 'rejected'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Migration patterns
--
-- This file is re-run in full on every deploy (railway.json → preDeployCommand
-- → `npm run db:init`). So every statement must be safe to run repeatedly and
-- must never lose data. Additive changes are trivial; destructive ones need a
-- guard so the SECOND run is a no-op instead of an error.
--
-- ADDITIVE — just add the statement, no guard needed:
--
--   CREATE TABLE IF NOT EXISTS notes (
--     id UUID PRIMARY KEY,
--     body TEXT NOT NULL
--   );
--   ALTER TABLE reviews    ADD COLUMN IF NOT EXISTS reviewer TEXT NOT NULL DEFAULT '';
--   CREATE INDEX IF NOT EXISTS idx_reviews_drug ON reviews(drug_name);
--
-- DESTRUCTIVE / TRANSFORMING — wrap in a guard so re-running is a no-op.
-- Postgres has no "IF EXISTS" form for these, so gate on the catalog:
--
--   -- Rename a column (only if the old name is still present):
--   DO $$
--   BEGIN
--     IF EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_name = 'reviews' AND column_name = 'drug_name') THEN
--       ALTER TABLE reviews RENAME COLUMN drug_name TO product_name;
--     END IF;
--   END $$;
--
--   -- Add a NOT NULL column to a table that already has rows: add it nullable,
--   -- backfill, THEN enforce NOT NULL — each step idempotent.
--   ALTER TABLE reviews ADD COLUMN IF NOT EXISTS market TEXT;
--   UPDATE reviews SET market = 'US' WHERE market IS NULL;
--   ALTER TABLE reviews ALTER COLUMN market SET NOT NULL;   -- no-op once set
--
--   -- Change a column type (guard so it doesn't re-run against the new type):
--   DO $$
--   BEGIN
--     IF (SELECT data_type FROM information_schema.columns
--         WHERE table_name = 'claims_library' AND column_name = 'confidence') = 'real' THEN
--       ALTER TABLE claims_library ALTER COLUMN confidence TYPE DOUBLE PRECISION;
--     END IF;
--   END $$;
--
-- DROPs (`DROP TABLE IF EXISTS` / `DROP COLUMN IF EXISTS`) are idempotent on
-- their own — but they delete data, so add them only when you truly mean it.
-- ============================================================================
