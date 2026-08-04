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
  -- Fingerprint of the reviewed input (normalized asset text + markets), for
  -- warning on an accidental re-run of the exact same asset. NULL on rows that
  -- predate the column — they simply won't match a dedup check.
  asset_hash   TEXT,
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
  -- 'revision' = approve with changes: the reviewer requests a specific edit
  -- (suggested_revision) rather than an outright accept or reject. Mirrors the
  -- real MLR approve / request-revision / reject model.
  decision    TEXT        NOT NULL CHECK (decision IN ('accepted', 'rejected', 'revision', 'cleared')),
  reviewer    TEXT        NOT NULL DEFAULT '',
  -- Why the decision was made (reject/revision) and, for a revision, the
  -- proposed replacement copy — this is what closes the MLR loop for the
  -- content team. Nullable: an accept usually needs neither.
  rationale          TEXT,
  suggested_revision TEXT,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decisions_review ON finding_decisions(review_id, decided_at DESC);

-- Upgrade existing installs: add the columns, then widen the decision CHECK to
-- allow 'revision'. Transforming, so guarded — drop the old constraint if present
-- and re-add the widened one (Postgres has no ADD CONSTRAINT IF NOT EXISTS).
ALTER TABLE finding_decisions ADD COLUMN IF NOT EXISTS rationale          TEXT;
ALTER TABLE finding_decisions ADD COLUMN IF NOT EXISTS suggested_revision TEXT;
ALTER TABLE finding_decisions DROP CONSTRAINT IF EXISTS finding_decisions_decision_check;
DO $$
BEGIN
  ALTER TABLE finding_decisions ADD CONSTRAINT finding_decisions_decision_check
    CHECK (decision IN ('accepted', 'rejected', 'revision', 'cleared'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

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
ALTER TABLE reviews        ADD COLUMN IF NOT EXISTS asset_hash  TEXT;
ALTER TABLE claims_library ADD COLUMN IF NOT EXISTS owner_sub   TEXT;
CREATE INDEX IF NOT EXISTS idx_reviews_owner ON reviews(owner_sub);
CREATE INDEX IF NOT EXISTS idx_library_owner ON claims_library(owner_sub);
CREATE INDEX IF NOT EXISTS idx_reviews_owner_created ON reviews(owner_sub, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_owner_created ON claims_library(owner_sub, created_at DESC);
-- Dedup lookup: an owner's recent reviews of a given asset fingerprint.
CREATE INDEX IF NOT EXISTS idx_reviews_owner_hash ON reviews(owner_sub, asset_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_review_finding_latest
  ON finding_decisions(review_id, finding_id, decided_at DESC, id DESC);

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

-- Free-trial metering (valyu mode): one row per ANONYMOUS review run, so the
-- deployment can cap free runs per visitor (fingerprint) and per network (ip),
-- and enforce a global daily budget so a spike can't drain the app key. Anon
-- reviews are otherwise ephemeral — this table is the only trace they leave.
CREATE TABLE IF NOT EXISTS anon_runs (
  id          BIGSERIAL PRIMARY KEY,
  fingerprint TEXT,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_anon_runs_fp ON anon_runs(fingerprint);
CREATE INDEX IF NOT EXISTS idx_anon_runs_ip ON anon_runs(ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anon_runs_created ON anon_runs(created_at DESC);

-- DeepResearch tasks. These run for minutes against the reviewer's own Valyu
-- credits, so losing track of one loses work they paid for: held here rather
-- than in the browser, which is what makes a run survive sign-out, a reload, or
-- moving to another machine.
--
-- Owner-scoped exactly like reviews (NULL = the self-hosted global tenant). The
-- task_id is Valyu's, and it is the primary key: polling upserts the same row as
-- the task progresses, so a status update can never fork into a second record.
CREATE TABLE IF NOT EXISTS dr_tasks (
  task_id     TEXT PRIMARY KEY,
  owner_sub   TEXT,
  kind        TEXT        NOT NULL,
  input       TEXT        NOT NULL,
  feature     TEXT        NOT NULL DEFAULT '',
  dataset     TEXT        NOT NULL DEFAULT '',
  status      TEXT        NOT NULL DEFAULT 'queued',
  title       TEXT,
  output      TEXT,
  -- [{ title, url }] as returned by DeepResearch.
  sources     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Valyu's typeset PDF of the report. Null for tasks created before the app
  -- started asking for a PDF output format, and for any that never rendered one.
  pdf_url     TEXT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dr_tasks_owner ON dr_tasks(owner_sub, created_at DESC);
-- Upgrade existing installs.
ALTER TABLE dr_tasks ADD COLUMN IF NOT EXISTS pdf_url TEXT;

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

-- ============================================================================
-- Reference packs (F-ref) — the reviewer's own approved source documents.
--
-- Named "reference pack", not "dossier": in this app a dossier is already the
-- DeepResearch-generated report about a drug. This is the opposite direction —
-- documents the reviewer supplies, which the asset's claims are actually cited
-- to. Approved PI, pivotal manuscripts, data-on-file memos, prior approved copy.
--
-- Why this exists: retrieval reaches licensed datasets, and roughly 0.13 claims
-- per run still come back with no source at all, concentrated on newer
-- specialised products where MLR review matters most. When the reviewer holds
-- the reference, "no source found" should become "supported by your reference".
--
-- Chunks carry their own embedding, matched in-app with cosine similarity, the
-- same approach claims_library already uses. A pack is tens to hundreds of
-- chunks, so this stays well inside what a scan can serve; if packs ever grow
-- into the thousands this is the thing to move to pgvector.
-- ============================================================================

CREATE TABLE IF NOT EXISTS reference_packs (
  id          UUID PRIMARY KEY,
  owner       TEXT,                    -- NULL in self-hosted (global), user id in valyu mode
  name        TEXT NOT NULL,
  drug_name   TEXT,                    -- optional: scopes the pack to one product
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reference_packs_owner_idx ON reference_packs (owner);

CREATE TABLE IF NOT EXISTS reference_docs (
  id          UUID PRIMARY KEY,
  pack_id     UUID NOT NULL REFERENCES reference_packs (id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime        TEXT,
  char_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reference_docs_pack_idx ON reference_docs (pack_id);

CREATE TABLE IF NOT EXISTS reference_chunks (
  id          UUID PRIMARY KEY,
  doc_id      UUID NOT NULL REFERENCES reference_docs (id) ON DELETE CASCADE,
  pack_id     UUID NOT NULL REFERENCES reference_packs (id) ON DELETE CASCADE,
  ordinal     INTEGER NOT NULL,        -- position in the document, for citing "part 3 of 11"
  text        TEXT NOT NULL,
  embedding   JSONB,                   -- OpenAI embedding vector; NULL if embedding failed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reference_chunks_pack_idx ON reference_chunks (pack_id);
