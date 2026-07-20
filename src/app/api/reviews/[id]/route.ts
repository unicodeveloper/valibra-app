import { NextResponse } from "next/server";
import { getReview } from "@/lib/db/client";

export const runtime = "nodejs";

/** Reopen a past review: the stored result plus the decisions made on it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const review = await getReview(id);
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
    const message = err instanceof Error ? err.message : "Failed to load review.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
