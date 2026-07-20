import { NextResponse } from "next/server";
import { listReviews } from "@/lib/db/client";

export const runtime = "nodejs";

/** Past reviews, newest first — the history list. Empty when persistence is off. */
export async function GET() {
  try {
    const reviews = await listReviews();
    return NextResponse.json({ reviews, persistenceEnabled: Boolean(process.env.DATABASE_URL) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list reviews.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
