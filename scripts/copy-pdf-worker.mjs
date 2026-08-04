/**
 * Copy the pdfjs worker into public/ so the browser can load it from our own
 * origin.
 *
 * Not committed and not fetched from a CDN. A CDN would be blocked by a strict
 * CSP and would make reference-pack uploads depend on a third-party host being
 * up; committing it would vendor a megabyte of build output that then silently
 * drifts from the installed pdfjs-dist. Copying on every build keeps the two in
 * lockstep by construction.
 *
 * Wired to predev/prebuild in package.json.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const dest = join(root, "public/pdf.worker.min.mjs");

if (!existsSync(src)) {
  console.log("[pdf-worker] pdfjs-dist not installed yet — skipping.");
  process.exit(0);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("[pdf-worker] copied to public/pdf.worker.min.mjs");
