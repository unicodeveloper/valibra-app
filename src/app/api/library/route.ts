import { NextResponse } from "next/server";
import { listLibrary } from "@/lib/db/client";

export const runtime = "nodejs";

/** F16 — list the reusable claims library (optionally filtered by ?drug=). */
export async function GET(req: Request) {
  const drug = new URL(req.url).searchParams.get("drug") ?? undefined;
  try {
    const entries = await listLibrary(drug);
    return NextResponse.json({ entries, persistenceEnabled: Boolean(process.env.DATABASE_URL) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list library.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
