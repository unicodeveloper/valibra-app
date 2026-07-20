-- Audit + review persistence. Run: npm run db:init (needs DATABASE_URL).
-- Persistence is optional; the pipeline returns full results either way.

CREATE TABLE IF NOT EXISTS reviews (
  id           UUID PRIMARY KEY,
  asset_name   TEXT        NOT NULL,
  drug_name    TEXT        NOT NULL DEFAULT '',
  result       JSONB       NOT NULL,
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
  -- provisional = the pipeline substantiated it, no human has looked yet.
  -- confirmed   = a reviewer accepted the substantiation finding.
  -- rejected    = a reviewer disagreed; never reused, never matched.
  status       TEXT        NOT NULL DEFAULT 'provisional'
                           CHECK (status IN ('provisional', 'confirmed', 'rejected')),
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (drug_name, claim_text)
);
CREATE INDEX IF NOT EXISTS idx_library_drug ON claims_library(drug_name);
-- Upgrade existing installs that predate these columns.
ALTER TABLE claims_library ADD COLUMN IF NOT EXISTS embedding JSONB;
ALTER TABLE claims_library ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'provisional';
ALTER TABLE claims_library ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
-- ADD COLUMN can't carry the CHECK on an upgrade, so attach it separately
-- (Postgres has no ADD CONSTRAINT IF NOT EXISTS).
DO $$
BEGIN
  ALTER TABLE claims_library ADD CONSTRAINT claims_library_status_check
    CHECK (status IN ('provisional', 'confirmed', 'rejected'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
