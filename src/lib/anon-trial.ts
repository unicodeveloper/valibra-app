import { isSelfHostedMode } from "./app-mode";
import { countAnonRuns } from "./db/client";

/**
 * Free-trial gating for the "one review before you sign up" funnel.
 *
 * In valyu mode a first-time visitor may run a small number of reviews with no
 * account, funded by the deployment's own VALYU_API_KEY. To keep that from being
 * an open cost/abuse surface, three limits stack:
 *
 *   1. per-visitor cap   — a stable client fingerprint may run ANON_FREE_RUNS.
 *   2. per-network daily  — an IP may run ANON_IP_DAILY_CAP/day (catches a
 *                           visitor clearing their fingerprint).
 *   3. global daily budget — total anon runs/day is bounded by ANON_DAILY_BUDGET
 *                           so a spike can never drain the deployment key.
 *
 * All three are metered in Postgres (anon_runs), so the trial requires a DB.
 */

const FREE_RUNS = Number(process.env.ANON_FREE_RUNS) || 1;
const IP_DAILY_CAP = Number(process.env.ANON_IP_DAILY_CAP) || 5;
const DAILY_BUDGET = Number(process.env.ANON_DAILY_BUDGET) || 200;

/**
 * The trial is available only when it can be both funded and metered: valyu
 * mode (so there are accounts to convert to), a deployment VALYU_API_KEY (to pay
 * for anon runs), and a database (to enforce the limits). Missing any of these,
 * an unauthenticated valyu-mode request falls back to "please sign in".
 */
export function trialAvailable(): boolean {
  return !isSelfHostedMode() && !!process.env.VALYU_API_KEY && !!process.env.DATABASE_URL;
}

/** The client's stable anon id, if it sent a well-formed one. */
export function anonFingerprint(req: Request): string | null {
  const fp = req.headers.get("x-anon-id");
  return fp && /^[A-Za-z0-9_-]{8,128}$/.test(fp) ? fp : null;
}

/** Best-effort client IP from the usual proxy headers. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/** Why a free run was refused — drives the client's messaging. */
export type AnonRefusal = "signup" | "ip_rate" | "budget";
export type AnonDecision = { ok: true } | { ok: false; reason: AnonRefusal };

/**
 * May this anonymous request run a free review right now? Checked before any
 * spend. `signup` is the common case (they've used their free run) and is the
 * one that should surface the sign-up wall; the others are abuse backstops.
 */
export async function checkAnonQuota(fingerprint: string | null, ip: string): Promise<AnonDecision> {
  if (fingerprint) {
    const used = await countAnonRuns({ fingerprint });
    if (used >= FREE_RUNS) return { ok: false, reason: "signup" };
  }
  const ipUsed = await countAnonRuns({ ip, sinceHours: 24 });
  if (ipUsed >= IP_DAILY_CAP) return { ok: false, reason: "ip_rate" };
  const total = await countAnonRuns({ sinceHours: 24 });
  if (total >= DAILY_BUDGET) return { ok: false, reason: "budget" };
  return { ok: true };
}

/** The user-facing message for a refusal — always steering toward sign-up. */
export function refusalMessage(reason: AnonRefusal): string {
  switch (reason) {
    case "signup":
      return "You've used your free review. Connect your Valyu account to run more and save your work.";
    case "ip_rate":
      return "Too many free reviews from this network today. Sign in with Valyu to keep going.";
    case "budget":
      return "The free trial is at capacity right now. Sign in with Valyu to run yours.";
  }
}
