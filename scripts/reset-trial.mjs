/**
 * Clears the anonymous free-trial meter so the sign-up funnel can be replayed
 * from a clean slate — first free run → the wall → sign in → claim — without
 * raising the caps away from their production values.
 *
 * The meter lives entirely in the anon_runs table (see src/lib/anon-trial.ts):
 * per-visitor fingerprint, per-IP daily, and the global daily budget are all
 * counted from those rows, so deleting them resets all three at once. Nothing
 * else references the table — anonymous reviews are never persisted — so this
 * cannot touch a saved review, a claim, or an account.
 *
 * Refuses a non-local DATABASE_URL unless --force is passed: this is a dev tool,
 * and running it against a deployed database would hand every visitor who has
 * used their free run another one.
 *
 * Usage: npm run dev:reset-trial
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[reset-trial] DATABASE_URL not set — nothing to reset (trial needs a DB).");
  process.exit(0);
}

const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(url);
const force = process.argv.includes("--force");
if (!local && !force) {
  console.error(
    "[reset-trial] DATABASE_URL is not local. Refusing — this would give every\n" +
      "              visitor a fresh free run. Pass --force if you really mean it.",
  );
  process.exit(1);
}

// Mirrors the TLS handling in scripts/db-init.mjs and src/lib/db/client.ts.
const internal = /\.railway\.internal[:/]/i.test(url);
const sslInUrl = /[?&]sslmode=/i.test(url);
const ssl = !sslInUrl && !local && !internal ? { rejectUnauthorized: false } : undefined;

const sql = postgres(url, { max: 1, onnotice: () => {}, ...(ssl ? { ssl } : {}) });

try {
  const rows = await sql`DELETE FROM anon_runs RETURNING 1`;
  console.log(`[reset-trial] Cleared ${rows.length} anon run(s). The free trial is fresh.`);
  await sql.end();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  // A missing table just means db:init hasn't run — not a failure worth a stack.
  if (/relation "anon_runs" does not exist/i.test(msg)) {
    console.log("[reset-trial] No anon_runs table yet — run `npm run db:init` first.");
    await sql.end().catch(() => {});
    process.exit(0);
  }
  console.error("[reset-trial] Failed:", msg);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
