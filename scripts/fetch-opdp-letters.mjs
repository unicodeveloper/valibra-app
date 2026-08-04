/**
 * Build the seeded OPDP enforcement-precedent library.
 *
 * Pulls every OPDP untitled letter issued in a given year from FDA's own index,
 * extracts the text, and writes src/lib/precedent/opdp-letters.json.
 *
 * Why a script and not a one-off paste: OPDP's output rate changed completely.
 * Five enforcement letters in each of 2023 and 2024, then close to a hundred in
 * a single week of September 2025, and 21 untitled letters across Jan-Jul 2026.
 * A snapshot pasted in by hand goes stale within weeks and nobody notices. Run
 * this to refresh it.
 *
 * Why only the current year by default: FDA's positions have been shifting. A
 * 2026 letter objected to a factual comparison of approved indications, the same
 * kind of claim FDA expressly permitted in a 2005 Zyrtec warning letter. Seeding
 * old letters as precedent risks teaching a position the agency has since
 * abandoned, which is worse than seeding nothing.
 *
 * FDA letters are US Government works and therefore public domain (17 USC 105),
 * so redistributing the text with the app is fine.
 *
 * Requires `pdftotext` (poppler): brew install poppler
 *
 * Usage:
 *   node scripts/fetch-opdp-letters.mjs           # current year
 *   node scripts/fetch-opdp-letters.mjs --year 2026
 *   node scripts/fetch-opdp-letters.mjs --limit 5 # smoke test
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src/lib/precedent/opdp-letters.json");
const INDEX =
  "https://www.fda.gov/drugs/warning-letters-and-notice-violation-letters-pharmaceutical-companies/untitled-letters";

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const YEAR = argOf("year", String(new Date().getFullYear()));
const LIMIT = Number(argOf("limit", "0"));

/** Pull the index page and parse the letter table out of the raw HTML.
 *  No DOM here: one fetch and a regex beats standing up a browser for a table. */
async function fetchIndex() {
  const res = await fetch(INDEX, { headers: { "user-agent": "openmlr-precedent-fetch" } });
  if (!res.ok) throw new Error(`index: HTTP ${res.status}`);
  const html = await res.text();

  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const out = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => m[1]);
    if (cells.length < 3) continue;

    const strip = (s) =>
      s
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ")
        .replace(/&#\d+;/g, "")
        .replace(/\s+/g, " ")
        .trim();

    const date = strip(cells[0]);
    if (!new RegExp(`/${YEAR}$`).test(date)) continue;

    // The letter PDF is the anchor whose text says "Untitled Letter".
    const link = [...cells[1].matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].find((a) =>
      /untitled letter/i.test(strip(a[2])),
    );
    if (!link) continue;

    const url = link[1].startsWith("http") ? link[1] : `https://www.fda.gov${link[1]}`;
    out.push({
      date,
      company: strip(cells[1]).replace(/Untitled Letter.*$/i, "").trim(),
      product: strip(cells[2]),
      url,
    });
  }
  return out;
}

/** Download a letter and extract its text. Returns "" when extraction fails, so
 *  one bad PDF costs that letter rather than the whole run. */
async function letterText(url, tmp) {
  try {
    const res = await fetch(url, { headers: { "user-agent": "openmlr-precedent-fetch" } });
    if (!res.ok) return "";
    const pdf = join(tmp, "letter.pdf");
    writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
    execFileSync("pdftotext", ["-layout", pdf, join(tmp, "letter.txt")]);
    const text = readFileSync(join(tmp, "letter.txt"), "utf8");
    // Everything after the signature block is boilerplate: submission addresses,
    // eCTD headings, the electronic-signature page. Cut it so a semantic match
    // lands on the findings rather than on Beltsville, Maryland.
    const cut = text.search(/\n\s*Sincerely,|Conclusion and Requested Action/i);
    const body = cut > 0 ? text.slice(0, text.indexOf("\n", cut + 400) + 1 || undefined) : text;
    return body.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } catch (err) {
    console.error(`  ! ${url}: ${err instanceof Error ? err.message : err}`);
    return "";
  }
}

const letters = await fetchIndex();
const wanted = LIMIT ? letters.slice(0, LIMIT) : letters;
console.log(`[opdp] ${letters.length} letter(s) dated ${YEAR}${LIMIT ? `, taking ${wanted.length}` : ""}`);

const tmp = mkdtempSync(join(tmpdir(), "opdp-"));
const docs = [];
try {
  for (const l of wanted) {
    process.stdout.write(`  ${l.date.padEnd(11)} ${l.product.slice(0, 46).padEnd(48)}`);
    const text = await letterText(l.url, tmp);
    if (!text) {
      console.log("skipped (no text)");
      continue;
    }
    docs.push({ ...l, chars: text.length, text });
    console.log(`${text.length.toLocaleString()} chars`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      source: INDEX,
      year: YEAR,
      fetchedAt: new Date().toISOString(),
      note:
        "FDA OPDP untitled letters. US Government works, public domain (17 USC 105). " +
        "Enforcement positions shift over time — treat these as dated precedent, not settled law.",
      letters: docs,
    },
    null,
    2,
  ),
);
console.log(
  `\n[opdp] wrote ${docs.length} letter(s), ${docs.reduce((n, d) => n + d.chars, 0).toLocaleString()} chars -> ${OUT.replace(ROOT + "/", "")}`,
);
