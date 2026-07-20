import { NextResponse } from "next/server";
import { z } from "zod";
import { getDecisions, recordDecision } from "@/lib/db/client";

export const runtime = "nodejs";

const RequestSchema = z.object({
  findingId: z.string().min(1, "findingId is required"),
  // "cleared" is a real decision, not an absence: a reviewer un-deciding a
  // finding is recorded, never erased.
  decision: z.enum(["accepted", "rejected", "cleared"]),
  reviewer: z.string().max(200).default(""),
});

/** Current decision per finding, for rehydrating a reopened review. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json({ decisions: await getDecisions(id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load decisions.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Record one accept/reject/clear. Append-only. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  if (!process.env.DATABASE_URL) {
    // Not an error the reviewer can act on mid-triage — the UI keeps the
    // decision locally and says persistence is off.
    return NextResponse.json({ persisted: false, reason: "persistence_disabled" });
  }

  const { findingId, decision, reviewer } = parsed.data;
  try {
    const out = await recordDecision(id, findingId, decision, reviewer);
    return NextResponse.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to record decision.";
    const unknownReview = /^Unknown review/.test(message);
    console.error("recordDecision failed:", err);
    return NextResponse.json({ error: message }, { status: unknownReview ? 404 : 500 });
  }
}
