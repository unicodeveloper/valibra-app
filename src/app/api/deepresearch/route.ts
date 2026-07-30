import { NextResponse } from "next/server";
import { z } from "zod";
import { createDeepResearch, getDeepResearchStatus, DR_KINDS } from "@/lib/deepresearch";
import {
  withValyuBilling,
  withPersistenceScope,
  currentIdentity,
  ValyuAuthError,
} from "@/lib/valyu-credentials";
import { createDrTask, updateDrTask, listDrTasks } from "@/lib/db/client";
import { logServerError, publicErrorMessage } from "@/lib/api-errors";

export const runtime = "nodejs";
export const maxDuration = 60; // create returns fast; the task runs async on Valyu

const CreateSchema = z.object({
  kind: z.enum(["device", "hcp", "indication", "surveillance", "dossier"]),
  input: z.string().min(1, "input is required"),
});

/** Kick off a DeepResearch task (F21/F22/F23/F25). Returns a task id immediately. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  return withValyuBilling(req, async () => {
    try {
      // The reviewer's own address, resolved server-side from their token —
      // never taken from the request, or this would be an open relay for
      // "Valyu emailed me about a report" messages to anyone.
      const identity = await currentIdentity();
      // Self-hosted has no signed-in user to notify, so the deployment names one
      // address (or none, and nobody is emailed).
      const alertEmail = identity?.email || process.env.DR_ALERT_EMAIL || null;
      const res = await createDeepResearch(parsed.data.kind, parsed.data.input, alertEmail);
      // Best-effort: the task is already running and billed, so a persistence
      // failure must not read to the client as a failed start.
      try {
        await createDrTask(identity, {
          taskId: res.taskId,
          kind: res.kind,
          input: parsed.data.input,
          feature: res.feature,
          dataset: res.dataset,
          status: res.status,
        });
      } catch (persistErr) {
        logServerError("createDrTask failed", persistErr);
      }
      return NextResponse.json(res);
    } catch (err) {
      if (err instanceof ValyuAuthError) {
        return NextResponse.json({ error: err.message, requiresReauth: true }, { status: 401 });
      }
      const message = publicErrorMessage(
        err,
        "DeepResearch create failed. Check the server logs for details.",
      );
      logServerError("createDeepResearch failed", err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}

/**
 * GET /api/deepresearch
 *   ?id=<taskId> — poll one task
 *   ?mine=1      — the caller's stored tasks, newest first
 *   (neither)    — the DR feature kinds
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  // The reviewer's own runs. Owner-scoped server-side, which is what lets a
  // DeepResearch task survive sign-out, a reload, or a different machine —
  // these cost real credits and take minutes, so losing one loses paid work.
  if (!id && url.searchParams.get("mine")) {
    return withPersistenceScope(req, async () => {
      try {
        const owner = await currentIdentity();
        return NextResponse.json({ tasks: await listDrTasks(owner) });
      } catch (err) {
        if (err instanceof ValyuAuthError) {
          return NextResponse.json({ error: err.message, requiresReauth: true }, { status: 401 });
        }
        const message = publicErrorMessage(err, "Could not list deep-research tasks.");
        logServerError("listDrTasks failed", err);
        return NextResponse.json({ error: message }, { status: 500 });
      }
    });
  }

  // Listing the DR feature kinds spends nothing and needs no session — keep it
  // open so the UI can render the Research tab before anyone signs in.
  if (!id) {
    return NextResponse.json({
      kinds: Object.entries(DR_KINDS).map(([k, s]) => ({
        kind: k,
        label: s.label,
        feature: s.feature,
        dataset: s.dataset,
      })),
    });
  }

  // Polling a task reaches into the owner's account, so it bills the same way
  // the create did — the poll must present the same reviewer's token.
  return withValyuBilling(req, async () => {
    try {
      const status = await getDeepResearchStatus(id);
      // Fold the poll into the stored row so the record is current even if the
      // reviewer closes the tab mid-run. Best-effort: a persistence failure must
      // not cost them the status they just paid to fetch.
      try {
        await updateDrTask(await currentIdentity(), id, {
          status: status.status,
          title: status.title,
          output: status.output,
          sources: status.sources ?? [],
          pdfUrl: status.pdfUrl,
          error: status.error,
        });
      } catch (persistErr) {
        logServerError("updateDrTask failed", persistErr);
      }
      return NextResponse.json(status);
    } catch (err) {
      if (err instanceof ValyuAuthError) {
        return NextResponse.json({ error: err.message, requiresReauth: true }, { status: 401 });
      }
      const message = publicErrorMessage(
        err,
        "DeepResearch status failed. Check the server logs for details.",
      );
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
