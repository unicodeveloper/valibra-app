import { NextResponse } from "next/server";
import { listReviews } from "@/lib/db/client";
import { withPersistenceScope, currentIdentity, ValyuAuthError } from "@/lib/valyu-credentials";

export const runtime = "nodejs";

/** Past reviews, newest first — the history list, scoped to the signed-in
 *  reviewer (valyu) or the global tenant (self-hosted). Empty when persistence
 *  is off. */
export async function GET(req: Request) {
  return withPersistenceScope(req, async () => {
    try {
      const owner = await currentIdentity();
      const reviews = await listReviews(owner);
      return NextResponse.json({ reviews, persistenceEnabled: Boolean(process.env.DATABASE_URL) });
    } catch (err) {
      if (err instanceof ValyuAuthError) {
        return NextResponse.json({ error: err.message, requiresReauth: true }, { status: 401 });
      }
      const message = err instanceof Error ? err.message : "Failed to list reviews.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
