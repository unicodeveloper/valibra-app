import { NextResponse } from "next/server";
import { listDrTasks } from "@/lib/db/client";
import { withPersistenceScope, currentIdentity, ValyuAuthError } from "@/lib/valyu-credentials";
import { buildDocx } from "@/lib/docx-report";
import { reportBody, reportSlug } from "@/lib/report";
import { logServerError, publicErrorMessage } from "@/lib/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/deepresearch/docx?id=<taskId> — the report as a Word document.
 *
 * Built server-side from the stored row rather than from anything the client
 * posts: the docx builder is too large to ship to the browser, and reading the
 * owner-scoped row means a guessed task id can't export somebody else's report.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  return withPersistenceScope(req, async () => {
    try {
      const owner = await currentIdentity();
      // Scoped read: listDrTasks only ever returns the caller's own rows.
      const task = (await listDrTasks(owner, 200)).find((t) => t.task_id === id);
      if (!task) return NextResponse.json({ error: "Report not found." }, { status: 404 });

      const title = task.title || task.input;
      const sources = Array.isArray(task.sources) ? task.sources : [];
      const buffer = await buildDocx({
        title,
        meta: `${task.dataset} · “${task.input}” · ${new Date(task.created_at).toISOString().slice(0, 10)}`,
        body: reportBody(task.output, sources.length),
        sources,
      });

      const filename = `${reportSlug(`${title}-${task.input}`)}-${new Date().toISOString().slice(0, 10)}.docx`;
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      if (err instanceof ValyuAuthError) {
        return NextResponse.json({ error: err.message, requiresReauth: true }, { status: 401 });
      }
      const message = publicErrorMessage(err, "Could not build the Word document.");
      logServerError("buildDocx failed", err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
