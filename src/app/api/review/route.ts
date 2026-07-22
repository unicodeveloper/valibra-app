import { NextResponse } from "next/server";
import { z } from "zod";
import { runReview } from "@/lib/pipeline";
import {
  persistReview,
  saveToLibrary,
  assetHash,
  findRecentByHash,
  type Owner,
} from "@/lib/db/client";
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

/** How recently an identical asset must have been reviewed to warn on a re-run.
 *  Default two weeks; env-tunable. */
const RERUN_WINDOW_HOURS = Number(process.env.RERUN_WINDOW_HOURS) || 336;

const RequestSchema = z.object({
  assetText: z.string().min(1, "assetText is required"),
  assetName: z.string().default("Untitled asset"),
  markets: z.array(z.enum(["US", "EU", "UK"])).default(["US"]), // F14
  // Set by the client's "Re-run anyway" action to bypass the duplicate warning.
  force: z.boolean().default(false),
});

/** Best-effort persistence — a DB outage must never fail a review. `owner` and
 *  `hash` are captured while the billing scope is still bound and passed in as
 *  plain values, because this runs fire-and-forget after the scope unwinds. */
function persist(result: ReviewResult, owner: Owner, hash: string | null) {
  // saveToLibrary is chained AFTER persistReview so the reviews row exists
  // first (the claims_library FK references it).
  persistReview(result, owner, hash)
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
  const { assetText, assetName, markets, force } = parsed.data;

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

  // Resolve the owner up front: it scopes persistence + F16 reuse, and the
  // dedup check below needs it too. A dead token surfaces here as a reauth.
  let owner: Owner;
  try {
    owner = await runScoped(token, currentIdentity);
  } catch (err) {
    if (err instanceof ValyuAuthError) {
      return NextResponse.json({ error: err.message, requiresReauth: true }, { status: 401 });
    }
    const message = publicErrorMessage(err, "Review failed. Check the server logs for details.");
    logServerError("identity resolution failed", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Don't silently re-spend on an identical asset the owner already reviewed
  // recently — hand the client a duplicate signal so it can offer to reopen the
  // prior review instead. Bypassed by an explicit "Re-run anyway" (force) and
  // when persistence is off (nothing to dedup against).
  const hash = assetHash(assetText, markets);
  if (process.env.DATABASE_URL && !force) {
    const previous = await findRecentByHash(owner, hash, RERUN_WINDOW_HOURS);
    if (previous) {
      return NextResponse.json({ duplicate: true, previous });
    }
  }

  // Clients that ask for a stream get the audit trail live as the pipeline
  // walks it; everyone else gets the same single JSON payload as before.
  if (req.headers.get("accept")?.includes("text/event-stream")) {
    return streamReview(assetText, assetName, markets, token, owner, hash);
  }

  try {
    const result = await runScoped(token, () => runReview(assetText, assetName, markets, owner));
    persist(result, owner, hash);
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
  owner: Owner,
  hash: string,
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
        // route handler returned, so any ambient scope is already gone. `owner`
        // was already resolved before streaming began and is passed straight in.
        const result = await runScoped(token, () =>
          runReview(assetText, assetName, markets, owner, (entry: AuditEntry) =>
            send("stage", entry),
          ),
        );
        persist(result, owner, hash);
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
