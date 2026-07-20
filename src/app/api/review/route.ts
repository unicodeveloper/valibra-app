import { NextResponse } from "next/server";
import { z } from "zod";
import { runReview } from "@/lib/pipeline";
import { persistReview, saveToLibrary } from "@/lib/db/client";
import type { AuditEntry, ReviewResult } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 300; // substantiation fans out across many Valyu calls

const RequestSchema = z.object({
  assetText: z.string().min(1, "assetText is required"),
  assetName: z.string().default("Untitled asset"),
  markets: z.array(z.enum(["US", "EU", "UK"])).default(["US"]), // F14
});

/** Best-effort persistence — a DB outage must never fail a review. */
function persist(result: ReviewResult) {
  // saveToLibrary is chained AFTER persistReview so the reviews row exists
  // first (the claims_library FK references it).
  persistReview(result)
    .then(() => saveToLibrary(result)) // F16
    .catch((e) => console.error("persistence failed:", e));
}

export async function POST(req: Request) {
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
  const { assetText, assetName, markets } = parsed.data;

  // Clients that ask for a stream get the audit trail live as the pipeline
  // walks it; everyone else gets the same single JSON payload as before.
  if (req.headers.get("accept")?.includes("text/event-stream")) {
    return streamReview(assetText, assetName, markets);
  }

  try {
    const result = await runReview(assetText, assetName, markets);
    persist(result);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Review failed.";
    console.error("runReview failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function streamReview(assetText: string, assetName: string, markets: string[]) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true; // client hung up
        }
      };

      try {
        const result = await runReview(assetText, assetName, markets, (entry: AuditEntry) =>
          send("stage", entry),
        );
        persist(result);
        send("done", result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Review failed.";
        console.error("runReview failed:", err);
        send("fail", { error: message });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // don't let a proxy sit on the stream
    },
  });
}
