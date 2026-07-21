/**
 * Schema migration runner — applies src/lib/db/schema.sql to DATABASE_URL.
 *
 * Runs on every deploy (wired to Railway's pre-deploy hook in railway.json) and
 * is safe to run repeatedly: schema.sql is forward-only and idempotent
 * (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, a guarded ADD
 * CONSTRAINT). It never drops a table or column, so no data is lost.
 *
 * Uses the `postgres` dependency rather than shelling out to `psql`, because the
 * Railway build/runtime image has Node but not the Postgres client.
 *
 * Scope: this applies ADDITIVE changes. Destructive migrations (renames, type
 * changes, drops) are deliberately not automated here — add them as explicit,
 * idempotent statements to schema.sql if you ever need one.
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.DATABASE_URL;
if (!url) {
  // Persistence is optional; a self-hosted deploy without a DB boots fine.
  console.log("[db:init] DATABASE_URL not set — skipping (persistence disabled).");
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "..", "src", "lib", "db", "schema.sql"), "utf8");

// TLS handling mirrors src/lib/db/client.ts: local and Railway's private network
// speak plaintext; a public managed host needs TLS without CA verification.
const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(url);
const internal = /\.railway\.internal[:/]/i.test(url);
const sslInUrl = /[?&]sslmode=/i.test(url);
const ssl = !sslInUrl && !local && !internal ? { rejectUnauthorized: false } : undefined;

const sql = postgres(url, {
  max: 1,
  // Silence "relation already exists, skipping" — expected on every re-run of an
  // idempotent schema; they'd otherwise bury the one line that matters below.
  onnotice: () => {},
  ...(ssl ? { ssl } : {}),
});

try {
  // One simple-protocol call runs the whole file, including the dollar-quoted
  // DO block — splitting on ";" would break that block.
  await sql.unsafe(schema);
  console.log("[db:init] Schema up to date (idempotent — no data dropped).");
  await sql.end();
} catch (err) {
  console.error("[db:init] Migration failed:", err instanceof Error ? err.message : err);
  await sql.end({ timeout: 5 }).catch(() => {});
  // Non-zero so a broken migration fails the deploy loudly instead of shipping
  // an app pointed at a stale schema.
  process.exit(1);
}
