import { NextResponse } from "next/server";
import { z } from "zod";
import { createDeepResearch, getDeepResearchStatus, DR_KINDS } from "@/lib/deepresearch";
import { withValyuBilling, ValyuAuthError } from "@/lib/valyu-credentials";
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
      const res = await createDeepResearch(parsed.data.kind, parsed.data.input);
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

/** Poll a DeepResearch task: GET /api/deepresearch?id=<taskId>. Also lists kinds. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");

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
