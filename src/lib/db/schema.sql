-- Phase 0 audit + review persistence. Run: npm run db:init (needs DATABASE_URL).
-- Persistence is optional in Phase 0; the pipeline returns full results either way.

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
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (drug_name, claim_text)
);
CREATE INDEX IF NOT EXISTS idx_library_drug ON claims_library(drug_name);
-- Upgrade existing installs that predate the embedding column.
ALTER TABLE claims_library ADD COLUMN IF NOT EXISTS embedding JSONB;
