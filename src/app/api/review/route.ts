import { NextResponse } from "next/server";
import { z } from "zod";
import { runReview } from "@/lib/pipeline";
import {
  persistReview,
  saveToLibrary,
  assetHash,
  findRecentByHash,
  recordAnonRun,
  type Owner,
} from "@/lib/db/client";
import {
  bearerToken,
  runScoped,
  retrievalReadiness,
  currentIdentity,
  ValyuAuthError,
} from "@/lib/valyu-credentials";
import { isSelfHostedMode } from "@/lib/app-mode";
import {
  trialAvailable,
  anonFingerprint,
  clientIp,
  checkAnonQuota,
  refusalMessage,
} from "@/lib/anon-trial";
import { logServerError, publicErrorMessage } from "@/lib/api-errors";
import type { AuditEntry, ReviewResult } from "@/lib/schemas";

/** An anonymous free-trial run: who to meter it against. Null for signed-in /
 *  self-hosted runs. */
type Anon = { fingerprint: string | null; ip: string } | null;

export const runtime = "nodejs";
export const maxDuration = 300; // substantiation fans out across many Valyu calls

/** How recently an identical asset must have been reviewed to warn on a re-run.
 *  Default two weeks; env-tunable. */
const RERUN_WINDOW_HOURS = Number(process.env.RERUN_WINDOW_HOURS) || 336;

const RequestSchema = z.object({
  assetText: z.string().min(1, "assetText is required"),
  assetName: z.string().default("Untitled asset"),
  // F14. "UK/EU" is the one non-US option the UI offers; bare "EU" and "UK" are
  // still accepted so a stored or reopened review can be re-run unchanged.
  markets: z.array(z.enum(["US", "UK/EU", "EU", "UK"])).default(["US"]),
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

  // Authorize + decide who pays. Three ways a run is allowed:
  //   signed-in  → billed to the reviewer's Valyu credits (owner resolved);
  //   self-hosted→ billed to the deployment key (no accounts);
  //   anon trial → valyu mode, no token: the deployment key funds up to a few
  //                free reviews to convert a first-time visitor, metered so it
  //                can't be abused. Anything else refuses before any spend.
  let owner: Owner = null;
  let anon: Anon = null;

  if (token || isSelfHostedMode()) {
    const ready = runScoped(token, retrievalReadiness);
    if (!ready.ok) {
      return NextResponse.json(
        ready.status === 401
          ? { error: ready.error, requiresReauth: true }
          : { error: ready.error },
        { status: ready.status },
      );
    }
    // Resolve the signed-in owner (self-hosted resolves to null). A dead token
    // surfaces here as a reauth.
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
  } else {
    // Valyu mode, no token → free-trial path, or fall back to "please sign in".
    if (!trialAvailable()) {
      return NextResponse.json(
        {
          error: "Sign in to run a review — it runs on your own Valyu credits.",
          requiresReauth: true,
        },
        { status: 401 },
      );
    }
    const fingerprint = anonFingerprint(req);
    const ip = clientIp(req);
    const q = await checkAnonQuota(fingerprint, ip);
    if (!q.ok) {
      // The wall. `requiresSignup` (not `requiresReauth`) tells the client to
      // show a sign-UP prompt rather than a "session expired" one.
      return NextResponse.json(
        { error: refusalMessage(q.reason), requiresSignup: true },
        { status: 401 },
      );
    }
    anon = { fingerprint, ip };
    // Reserve the free run BEFORE any spend. Recording it after the run (which
    // takes tens of seconds) leaves a wide window where concurrent requests all
    // pass the quota check and blow past the caps — draining the deployment key.
    // Reserving up front shrinks that race to the check→insert gap; a run that
    // then fails "costs" the slot, which is the right trade for cost safety.
    await recordAnonRun(fingerprint, ip);
  }

  // Don't silently re-spend on an identical asset the owner already reviewed
  // recently — hand the client a duplicate signal so it can offer to reopen the
  // prior review instead. Skipped for anon runs (they keep no history) and on an
  // explicit "Re-run anyway" (force).
  const hash = assetHash(assetText, markets);
  if (!anon && process.env.DATABASE_URL && !force) {
    const previous = await findRecentByHash(owner, hash, RERUN_WINDOW_HOURS);
    if (previous) {
      return NextResponse.json({ duplicate: true, previous });
    }
  }

  // Clients that ask for a stream get the audit trail live as the pipeline
  // walks it; everyone else gets the same single JSON payload as before.
  if (req.headers.get("accept")?.includes("text/event-stream")) {
    return streamReview(assetText, assetName, markets, token, owner, hash, anon);
  }

  try {
    const result = await runScoped(token, () => runReview(assetText, assetName, markets, owner));
    // Anon runs are ephemeral — the metering row was already reserved up front.
    if (!anon) persist(result, owner, hash);
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
  anon: Anon,
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
        // Anon runs are ephemeral — the metering row was already reserved up front.
        if (!anon) persist(result, owner, hash);
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
