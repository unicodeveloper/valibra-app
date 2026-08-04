"use client";

/**
 * Extract text from a PDF in the browser.
 *
 * Deliberately client-side. The reference API takes plain text, so the server
 * never has to parse an arbitrary binary a reviewer uploaded, and a malformed
 * or hostile PDF can only spoil the tab it was dropped into. It also means the
 * document itself is never transmitted — only the text the reviewer can see was
 * extracted, which matters when the file is an unpublished data-on-file memo.
 *
 * pdfjs is imported lazily so its weight lands only on reviewers who actually
 * drop a PDF, rather than in the bundle everyone downloads.
 */

/** Page separator kept explicit so a citation can say which page a passage is on. */
const PAGE_BREAK = "\n\n";

export interface PdfExtract {
  text: string;
  pages: number;
  /** Pages that yielded no text at all. A scanned PDF produces all of them, and
   *  the reviewer needs telling rather than silently getting an empty pack. */
  emptyPages: number;
}

export async function extractPdfText(file: File): Promise<PdfExtract> {
  const pdfjs = await import("pdfjs-dist");

  // Served from our own origin, copied into public/ on every build by
  // scripts/copy-pdf-worker.mjs. Not a CDN: a strict CSP would block it, and an
  // upload should not depend on a third-party host being reachable.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;

  const parts: string[] = [];
  let emptyPages = 0;

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = content.items
      .map((i) => ("str" in i ? i.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) emptyPages++;
    else parts.push(text);
  }

  return { text: parts.join(PAGE_BREAK), pages: doc.numPages, emptyPages };
}
