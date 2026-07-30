import { NextResponse } from "next/server";
import { listLibrarySummaries } from "@/lib/db/client";
import { withPersistenceScope, currentIdentity, ValyuAuthError } from "@/lib/valyu-credentials";

export const runtime = "nodejs";

/** F16 — list the reusable claims library (optionally filtered by ?drug=),
 *  scoped to the signed-in reviewer (valyu) or the global tenant (self-hosted). */
export async function GET(req: Request) {
  const drug = new URL(req.url).searchParams.get("drug") ?? undefined;
  return withPersistenceScope(req, async () => {
    try {
      const owner = await currentIdentity();
      const entries = await listLibrarySummaries(drug, owner);
      return NextResponse.json({ entries, persistenceEnabled: Boolean(process.env.DATABASE_URL) });
    } catch (err) {
      if (err instanceof ValyuAuthError) {
        return NextResponse.json({ error: err.message, requiresReauth: true }, { status: 401 });
      }
      const message = err instanceof Error ? err.message : "Failed to list library.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
