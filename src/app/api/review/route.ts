import { NextResponse } from "next/server";
import { z } from "zod";
import { runReview } from "@/lib/pipeline";
import { persistReview, saveToLibrary, type Owner } from "@/lib/db/client";
import {
  bearerToken,
  runScoped,
  retrievalReadiness,
  currentIdentity,
  ValyuAuthError,
} from "@/lib/valyu-credentials";
import { logServerError, publicErrorMessage } from "@/lib/api-errors";
import type { AuditEntry, ReviewResult } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 300; // substantiation fans out across many Valyu calls

const RequestSchema = z.object({
  assetText: z.string().min(1, "assetText is required"),
  assetName: z.string().default("Untitled asset"),
  markets: z.array(z.enum(["US", "EU", "UK"])).default(["US"]), // F14
});

/** Best-effort persistence — a DB outage must never fail a review. `owner` is
 *  captured while the billing scope is still bound and passed in as a plain
 *  value, because this runs fire-and-forget after the scope has unwound. */
function persist(result: ReviewResult, owner: Owner) {
  // saveToLibrary is chained AFTER persistReview so the reviews row exists
  // first (the claims_library FK references it).
  persistReview(result, owner)
    .then(() => saveToLibrary(result, owner)) // F16
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

  // Who pays for this review's ~15 Valyu searches. Captured here and threaded
  // explicitly into the run below, rather than relying on an ambient scope, so
  // it survives into the streaming path's deferred callback. See runScoped.
  const token = bearerToken(req);

  // Refuse before any Valyu spend if this request can't pay — valyu mode
  // without a token, or self-hosted without a key.
  const ready = runScoped(token, retrievalReadiness);
  if (!ready.ok) {
    return NextResponse.json(
      ready.status === 401 ? { error: ready.error, requiresReauth: true } : { error: ready.error },
      { status: ready.status },
    );
  }

  // Clients that ask for a stream get the audit trail live as the pipeline
  // walks it; everyone else gets the same single JSON payload as before.
  if (req.headers.get("accept")?.includes("text/event-stream")) {
    return streamReview(assetText, assetName, markets, token);
  }

  try {
    const { result, owner } = await runScoped(token, async () => {
      // Resolve the owner inside the scope so persistence is attributed to the
      // signed-in reviewer (valyu) or null (self-hosted); also scopes F16 reuse.
      const owner = await currentIdentity();
      const result = await runReview(assetText, assetName, markets, owner);
      return { result, owner };
    });
    persist(result, owner);
    return NextResponse.json(result);
  } catch (err) {
    // A dead token mid-review is a reauth prompt, not a generic 500.
    if (err instanceof ValyuAuthError) {
      return NextResponse.json({ error: err.message, requiresReauth: true }, { status: 401 });
    }
    const message = publicErrorMessage(err, "Review failed. Check the server logs for details.");
    logServerError("runReview failed", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function streamReview(
  assetText: string,
  assetName: string,
  markets: string[],
  token: string | null,
) {
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
        // Re-bind the billing credential here: this callback runs after the
        // route handler returned, so any ambient scope is already gone.
        const { result, owner } = await runScoped(token, async () => {
          const owner = await currentIdentity();
          const result = await runReview(
            assetText,
            assetName,
            markets,
            owner,
            (entry: AuditEntry) => send("stage", entry),
          );
          return { result, owner };
        });
        persist(result, owner);
        send("done", result);
      } catch (err) {
        const message =
          err instanceof ValyuAuthError
            ? err.message
            : publicErrorMessage(err, "Review failed. Check the server logs for details.");
        logServerError("runReview failed", err);
        // Carry the reauth hint through the stream so the client can reopen
        // sign-in on an expired token, same as the non-streaming path.
        send("fail", { error: message, requiresReauth: err instanceof ValyuAuthError });
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
