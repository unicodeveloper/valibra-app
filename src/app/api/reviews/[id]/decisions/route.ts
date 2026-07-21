import { NextResponse } from "next/server";
import { z } from "zod";
import { getDecisions, recordDecision } from "@/lib/db/client";
import { withPersistenceScope, currentIdentity, ValyuAuthError } from "@/lib/valyu-credentials";

export const runtime = "nodejs";

const RequestSchema = z.object({
  findingId: z.string().min(1, "findingId is required"),
  // "cleared" is a real decision, not an absence: a reviewer un-deciding a
  // finding is recorded, never erased.
  decision: z.enum(["accepted", "rejected", "cleared"]),
  // Advisory only: in valyu mode the server overrides this with the
  // authenticated email, so the audit trail names a verified identity.
  reviewer: z.string().max(200).default(""),
});

/** Current decision per finding, for rehydrating a reopened review. Scoped to
 *  the owner via the parent review. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withPersistenceScope(req, async () => {
    try {
      const owner = await currentIdentity();
      return NextResponse.json({ decisions: await getDecisions(id, owner) });
    } catch (err) {
      if (err instanceof ValyuAuthError) {
        return NextResponse.json({ error: err.message, requiresReauth: true }, { status: 401 });
      }
      const message = err instanceof Error ? err.message : "Failed to load decisions.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}

/** Record one accept/reject/clear. Append-only. Only the review's owner may
 *  write — a decision on another account's review reads as an unknown review. */
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
  return withPersistenceScope(req, async () => {
    try {
      const owner = await currentIdentity();
      const out = await recordDecision(id, findingId, decision, reviewer, owner);
      return NextResponse.json(out);
    } catch (err) {
      if (err instanceof ValyuAuthError) {
        return NextResponse.json({ error: err.message, requiresReauth: true }, { status: 401 });
      }
      const message = err instanceof Error ? err.message : "Failed to record decision.";
      const unknownReview = /^Unknown review/.test(message);
      console.error("recordDecision failed:", err);
      return NextResponse.json({ error: message }, { status: unknownReview ? 404 : 500 });
    }
  });
}
