import { NextResponse } from "next/server";
import { getReview } from "@/lib/db/client";
import { withPersistenceScope, currentIdentity, ValyuAuthError } from "@/lib/valyu-credentials";

export const runtime = "nodejs";

/** Review ids are UUIDs. Reject anything else up front so a malformed URL is a
 *  clean 404 rather than a raw Postgres "invalid input syntax for type uuid". */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reopen a past review: the stored result plus the decisions made on it.
 *  Scoped to the owner — a review that isn't the caller's reads as 404, so a
 *  guessed UUID can't surface another account's asset. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "No such review." }, { status: 404 });
  }
  return withPersistenceScope(req, async () => {
    try {
      const owner = await currentIdentity();
      const review = await getReview(id, owner);
      if (!review) {
        return NextResponse.json(
          {
            error: process.env.DATABASE_URL
              ? "No such review."
              : "Persistence is off — set DATABASE_URL to keep review history.",
          },
          { status: 404 },
        );
      }
      return NextResponse.json(review);
    } catch (err) {
      if (err instanceof ValyuAuthError) {
        return NextResponse.json({ error: err.message, requiresReauth: true }, { status: 401 });
      }
      const message = err instanceof Error ? err.message : "Failed to load review.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
