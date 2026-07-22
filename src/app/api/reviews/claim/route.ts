import { NextResponse } from "next/server";
import { persistReview, saveToLibrary } from "@/lib/db/client";
import { withPersistenceScope, currentIdentity, ValyuAuthError } from "@/lib/valyu-credentials";
import { logServerError } from "@/lib/api-errors";
import type { ReviewResult } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Claim a free-trial review into the account that just signed in.
 *
 * A free (anonymous) run is ephemeral — the result lives only in the visitor's
 * tab. When they connect Valyu at the wall, the client posts that result here so
 * it becomes their first saved review + library entries, closing the loop. It
 * only ever writes to the caller's own account (scoped via withPersistenceScope),
 * and persistReview is idempotent on reviewId, so claiming twice is harmless.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const result = (body as { result?: unknown })?.result as ReviewResult | undefined;
  // Minimal shape check — this only ever lands in the caller's own library, but
  // reject obvious garbage so a malformed claim can't wedge persistence.
  if (
    !result ||
    typeof result !== "object" ||
    typeof result.reviewId !== "string" ||
    !Array.isArray(result.findings) ||
    !Array.isArray(result.claims)
  ) {
    return NextResponse.json({ error: "Nothing valid to claim." }, { status: 400 });
  }

  return withPersistenceScope(req, async () => {
    try {
      const owner = await currentIdentity();
      await persistReview(result, owner, null);
      await saveToLibrary(result, owner);
      return NextResponse.json({ claimed: true, id: result.reviewId });
    } catch (err) {
      if (err instanceof ValyuAuthError) {
        return NextResponse.json({ error: err.message, requiresReauth: true }, { status: 401 });
      }
      const message = err instanceof Error ? err.message : "Failed to claim review.";
      logServerError("claimReview failed", err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
