import { NextResponse } from "next/server";
import { listLibrary } from "@/lib/db/client";
import { withPersistenceScope, currentIdentity, ValyuAuthError } from "@/lib/valyu-credentials";

export const runtime = "nodejs";

/** F16 — list the reusable claims library (optionally filtered by ?drug=),
 *  scoped to the signed-in reviewer (valyu) or the global tenant (self-hosted). */
export async function GET(req: Request) {
  const drug = new URL(req.url).searchParams.get("drug") ?? undefined;
  return withPersistenceScope(req, async () => {
    try {
      const owner = await currentIdentity();
      // Drop the embedding vectors. They're ~31KB of JSON per row and exist for
      // server-side semantic claim matching (see pipeline/index.ts, which calls
      // listLibrary directly and still gets them) — the library UI never reads
      // one. Left in, they were 63% of this response at 13 rows, and the query
      // caps at 200.
      const entries = (await listLibrary(drug, owner)).map(
        ({ embedding: _embedding, ...entry }) => entry,
      );
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
