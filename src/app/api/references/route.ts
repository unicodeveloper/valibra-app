import { NextResponse } from "next/server";
import { z } from "zod";
import { createPack, addDocument, listPacks, deletePack } from "@/lib/references";
import { withPersistenceScope, currentIdentity, ValyuAuthError } from "@/lib/valyu-credentials";
import { precedentSummary } from "@/lib/precedent";

export const runtime = "nodejs";
export const maxDuration = 120; // embedding a long document takes a while

/**
 * Reference packs: the reviewer's own approved source documents.
 *
 * Takes plain text rather than files. The server never has to trust a parser
 * with an arbitrary binary, and a reviewer can supply a data-on-file memo that
 * exists in no file at all. Extraction from PDF/DOCX belongs client-side.
 */

const CreateSchema = z.object({
  name: z.string().min(1, "name is required"),
  drugName: z.string().nullable().default(null),
  kind: z.enum(["reference", "precedent"]).default("reference"),
  documents: z
    .array(
      z.object({
        filename: z.string().min(1),
        mime: z.string().default("text/plain"),
        text: z.string().min(1),
      }),
    )
    .min(1, "at least one document is required"),
});

export async function GET(req: Request) {
  return withPersistenceScope(req, async () => {
    try {
      const packs = await listPacks(await currentIdentity());
      return NextResponse.json({
        packs,
        // The seeded OPDP library ships with the app: metadata only here, so the
        // tab can list it without shipping 159k characters of letter text to the
        // browser on every load.
        precedent: precedentSummary(),
        persistenceEnabled: Boolean(process.env.DATABASE_URL),
      });
    } catch (err) {
      if (err instanceof ValyuAuthError) {
        return NextResponse.json({ error: err.message, requiresReauth: true }, { status: 401 });
      }
      const message = err instanceof Error ? err.message : "Failed to list reference packs.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }, "your reference packs");
}

export async function POST(req: Request) {
  return withPersistenceScope(req, async () => {
    try {
      const parsed = CreateSchema.safeParse(await req.json());
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues.map((i) => i.message).join("; ") },
          { status: 400 },
        );
      }
      const { name, drugName, kind, documents } = parsed.data;
      const packId = await createPack(name, drugName, await currentIdentity(), kind);

      let chunks = 0;
      for (const d of documents) {
        chunks += (await addDocument(packId, d.filename, d.mime, d.text)).chunks;
      }
      return NextResponse.json({ packId, documents: documents.length, chunks });
    } catch (err) {
      if (err instanceof ValyuAuthError) {
        return NextResponse.json({ error: err.message, requiresReauth: true }, { status: 401 });
      }
      const message = err instanceof Error ? err.message : "Failed to create reference pack.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }, "your reference packs");
}

/** Remove a pack and everything in it. Chunks and docs cascade. */
export async function DELETE(req: Request) {
  return withPersistenceScope(req, async () => {
    try {
      const id = new URL(req.url).searchParams.get("id");
      if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      const removed = await deletePack(id, await currentIdentity());
      if (!removed) return NextResponse.json({ error: "Pack not found." }, { status: 404 });
      return NextResponse.json({ deleted: id });
    } catch (err) {
      if (err instanceof ValyuAuthError) {
        return NextResponse.json({ error: err.message, requiresReauth: true }, { status: 401 });
      }
      const message = err instanceof Error ? err.message : "Failed to delete reference pack.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }, "your reference packs");
}
