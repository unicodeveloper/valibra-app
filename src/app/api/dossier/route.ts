import { NextResponse } from "next/server";
import { z } from "zod";
import { buildDossier } from "@/lib/pipeline/dossier";

export const runtime = "nodejs";
export const maxDuration = 300;

const RequestSchema = z.object({ drug: z.string().min(1, "drug is required") });

/** F18 — POST { drug } → grounded deep-research evidence dossier. */
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

  try {
    const result = await buildDossier(parsed.data.drug);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Dossier failed.";
    console.error("buildDossier failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
