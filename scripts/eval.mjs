/**
 * Evaluation harness — does a pipeline change make review better, or just different?
 *
 * Runs every corpus asset through the real /api/review path N times and reports
 * spread alongside the mean. The pipeline is nondeterministic (claim extraction
 * and retrieval both vary run to run), so a single run cannot tell a fix from
 * noise — that is the whole reason this exists, and why instability is reported
 * as a metric rather than smoothed away.
 *
 * The headline number is criticals-per-run on the `clean` assets: copy a
 * reviewer should get nothing critical back on. Everything in this repo used to
 * be tuned on assets engineered to flag, which measures sensitivity and never
 * measures specificity.
 *
 * Usage:
 *   npm run eval                    whole corpus, 2 runs each
 *   npm run eval -- --runs 3        more repeats
 *   npm run eval -- --only clean    substring match on asset id
 *
 * Requires the dev server and a local DATABASE_URL.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS = join(ROOT, "eval", "corpus");
const RESULTS = join(ROOT, "eval", "results");

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const RUNS = Number(argOf("runs", 2));
const ONLY = argOf("only", "");
const BASE = process.env.EVAL_BASE_URL || "http://localhost:3001";
/** A content-filter rejection kills a whole review; retry once before counting it. */
const RETRIES = Number(argOf("retries", 1));

/**
 * The anonymous-trial meter has to be cleared before EVERY review, not once at
 * startup: a full corpus pass is far more reviews than the free trial allows, so
 * clearing once just moves the signup wall a few assets in. (First version of
 * this script did exactly that and reported four assets as hard failures that
 * were really 401s.)
 *
 * Same guard as scripts/reset-trial.mjs — refuses a non-local database, because
 * doing this to a deployment hands every visitor a fresh run.
 */
let meterSql = null;
let meterStatus = null;

function initMeter() {
  const url = process.env.DATABASE_URL;
  if (!url) return "no DATABASE_URL — trial meter not cleared";
  if (!/@(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(url)) {
    return "DATABASE_URL is not local — refusing to clear (see reset-trial.mjs)";
  }
  meterSql = postgres(url, { max: 1, onnotice: () => {} });
  return "local DB — clearing before each review";
}

async function clearMeter() {
  if (!meterSql) return;
  try {
    await meterSql`DELETE FROM anon_runs`;
  } catch {
    /* best-effort: a meter we can't clear surfaces as a 401 below */
  }
}

async function review(assetText, assetName) {
  await clearMeter();
  const res = await fetch(`${BASE}/api/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assetText, assetName, markets: ["US"], force: true }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error ?? "";
    } catch {
      /* non-JSON body */
    }
    throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  return res.json();
}

/** Findings of a given severity. */
const countSev = (r, sev) => r.findings.filter((f) => f.severity === sev).length;

/**
 * Claims whose retrieval came back empty while reporting no error. These are
 * invisible to the reviewer — indistinguishable from "we searched and found
 * nothing" — so they get their own counter rather than being folded into
 * unverified.
 */
function zeroSourceClaims(r) {
  return Object.values(r.substantiation).filter((s) => s.evidence.length === 0 && !s.error).length;
}

/** Fraction of claim texts whose verdict was identical in every run that saw them. */
function verdictAgreement(runs) {
  const byText = new Map();
  for (const r of runs) {
    for (const c of r.claims) {
      const v = r.substantiation[c.id]?.verification?.verdict;
      if (!v) continue;
      const key = c.text.trim().toLowerCase();
      if (!byText.has(key)) byText.set(key, []);
      byText.get(key).push(v);
    }
  }
  const shared = [...byText.values()].filter((v) => v.length > 1);
  if (shared.length === 0) return null;
  const agreed = shared.filter((v) => v.every((x) => x === v[0])).length;
  return agreed / shared.length;
}

/**
 * Was the defective claim actually flagged, in every run?
 *
 * Category presence is a weak proxy and it misled me: the eliquis asset was
 * reported as "missed drug-interaction" while the offending claim was in fact
 * caught as a critical substantiation finding in every single run. Only the
 * label on the box had moved. What matters to a reviewer is whether the bad
 * claim got flagged at all — so assert that, per claim, across every run.
 */
function claimFlaggedEveryRun(runs, needle) {
  const n = needle.toLowerCase();
  return runs.every((r) =>
    r.findings.some(
      (f) =>
        (f.severity === "critical" || f.severity === "warning") &&
        (f.claimText ?? "").toLowerCase().includes(n),
    ),
  );
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fmt = (x, d = 1) => (x == null ? "—" : Number(x).toFixed(d));

async function evaluateAsset(asset) {
  const runs = [];
  const failures = [];
  for (let i = 0; i < RUNS; i++) {
    let done = false;
    for (let attempt = 0; attempt <= RETRIES && !done; attempt++) {
      try {
        runs.push(await review(asset.assetText, asset.name));
        done = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === RETRIES) failures.push(msg);
        else process.stdout.write(" retry");
      }
    }
    process.stdout.write(done ? "." : "x");
  }

  if (runs.length === 0) {
    return { id: asset.id, kind: asset.kind, name: asset.name, runs: 0, failures, ok: false };
  }

  const claims = runs.map((r) => r.claims.length);
  const crits = runs.map((r) => countSev(r, "critical"));
  const categoriesSeen = new Set(runs.flatMap((r) => r.findings.map((f) => f.category)));
  const expected = asset.expect?.categories ?? [];
  const hit = expected.filter((c) => categoriesSeen.has(c));
  const expectedClaims = asset.expect?.flaggedClaims ?? [];
  const flaggedClaims = expectedClaims.filter((t) => claimFlaggedEveryRun(runs, t));
  const missedClaims = expectedClaims.filter((t) => !flaggedClaims.includes(t));

  // A clean asset passes only if it clears its bar on EVERY run — a bar met on
  // average but blown on one run in three is not a bar a reviewer can trust.
  const maxCritical = asset.expect?.maxCritical;
  const ok =
    asset.kind === "clean"
      ? maxCritical == null || Math.max(...crits) <= maxCritical
      : hit.length === expected.length && flaggedClaims.length === expectedClaims.length;

  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    runs: runs.length,
    failures,
    ok,
    maxCritical: maxCritical ?? null,
    claimsMin: Math.min(...claims),
    claimsMax: Math.max(...claims),
    claimSpread: Math.max(...claims) - Math.min(...claims),
    criticalsMean: mean(crits),
    criticalsMax: Math.max(...crits),
    criticalsPerRun: crits,
    warningsMean: mean(runs.map((r) => countSev(r, "warning"))),
    unverifiedMean: mean(runs.map((r) => countSev(r, "unverified"))),
    zeroSourceMean: mean(runs.map(zeroSourceClaims)),
    verdictAgreement: verdictAgreement(runs),
    expectedCategories: expected,
    matchedCategories: hit,
    missedCategories: expected.filter((c) => !categoriesSeen.has(c)),
    expectedClaims,
    flaggedClaims,
    missedClaims,
  };
}

// ---------------------------------------------------------------- main ----

const files = readdirSync(CORPUS).filter((f) => f.endsWith(".json"));
const corpus = files
  .map((f) => JSON.parse(readFileSync(join(CORPUS, f), "utf8")))
  .filter((a) => !ONLY || a.id.includes(ONLY))
  .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

if (corpus.length === 0) {
  console.error(`[eval] No corpus assets matched --only "${ONLY}".`);
  process.exit(1);
}

console.log(`[eval] ${corpus.length} asset(s) × ${RUNS} run(s) against ${BASE}`);
console.log(`[eval] trial meter: ${initMeter()}\n`);

const results = [];
for (const asset of corpus) {
  process.stdout.write(`  ${asset.id.padEnd(32)} `);
  const r = await evaluateAsset(asset);
  results.push(r);
  console.log(
    r.runs === 0
      ? " FAILED"
      : ` ${r.ok ? "PASS" : "FAIL"}  claims ${r.claimsMin}-${r.claimsMax}  crit ${r.criticalsPerRun.join("/")}`,
  );
}

const clean = results.filter((r) => r.kind === "clean" && r.runs > 0);
const defective = results.filter((r) => r.kind === "defective" && r.runs > 0);
const totalExpected = defective.reduce((a, r) => a + r.expectedCategories.length, 0);
const totalMatched = defective.reduce((a, r) => a + r.matchedCategories.length, 0);
const totalClaims = defective.reduce((a, r) => a + (r.expectedClaims?.length ?? 0), 0);
const totalFlagged = defective.reduce((a, r) => a + (r.flaggedClaims?.length ?? 0), 0);
const hardFailures = results.reduce((a, r) => a + r.failures.length, 0);
const attempted = corpus.length * RUNS;

const summary = {
  timestamp: new Date().toISOString(),
  base: BASE,
  runsPerAsset: RUNS,
  assets: corpus.length,
  falsePositiveRate: clean.length ? mean(clean.map((r) => r.criticalsMean)) : null,
  worstCleanCriticals: clean.length ? Math.max(...clean.map((r) => r.criticalsMax)) : null,
  recall: totalExpected ? totalMatched / totalExpected : null,
  defectRecall: totalClaims ? totalFlagged / totalClaims : null,
  meanClaimSpread: mean(results.filter((r) => r.runs > 0).map((r) => r.claimSpread)),
  verdictAgreement: mean(
    results.filter((r) => r.verdictAgreement != null).map((r) => r.verdictAgreement),
  ),
  zeroSourceClaimsPerRun: mean(results.filter((r) => r.runs > 0).map((r) => r.zeroSourceMean)),
  hardFailures,
  hardFailureRate: attempted ? hardFailures / attempted : 0,
  passed: results.filter((r) => r.ok).length,
  total: results.length,
};

console.log("\n──────────────────────────────── scoreboard ────────────────────────────────");
console.log(`  clean-set criticals per run   ${fmt(summary.falsePositiveRate, 2)}   (worst single run: ${summary.worstCleanCriticals ?? "—"})`);
console.log(`  defective claims flagged      ${summary.defectRecall == null ? "—" : `${fmt(summary.defectRecall * 100, 0)}%  (${totalFlagged}/${totalClaims} claims, every run)`}`);
console.log(`  category recall (weak proxy)  ${summary.recall == null ? "—" : `${fmt(summary.recall * 100, 0)}%  (${totalMatched}/${totalExpected})`}`);
console.log(`  mean claim spread across runs ${fmt(summary.meanClaimSpread, 1)}`);
console.log(`  verdict agreement across runs ${summary.verdictAgreement ? `${fmt(summary.verdictAgreement * 100, 0)}%` : "—"}`);
console.log(`  silent zero-source claims/run ${fmt(summary.zeroSourceClaimsPerRun, 2)}`);
console.log(`  hard failures                 ${hardFailures}/${attempted}  (${fmt(summary.hardFailureRate * 100, 0)}%)`);
console.log(`  assets passing                ${summary.passed}/${summary.total}`);
console.log("────────────────────────────────────────────────────────────────────────────");

for (const r of results.filter((x) => !x.ok)) {
  if (r.runs === 0) console.log(`  ✗ ${r.id}: every run failed — ${r.failures[0] ?? "unknown"}`);
  else if (r.kind === "clean") console.log(`  ✗ ${r.id}: ${r.criticalsMax} critical(s) on its worst run, bar is ${r.maxCritical ?? 0}`);
  else {
    const parts = [];
    if (r.missedCategories.length) parts.push(`categories: ${r.missedCategories.join(", ")}`);
    if (r.missedClaims?.length) parts.push(`claims never flagged: "${r.missedClaims.join('" / "')}"`);
    console.log(`  ✗ ${r.id}: missed ${parts.join("; ")}`);
  }
}
if (hardFailures) {
  console.log(`\n  hard failure detail:`);
  for (const r of results.filter((x) => x.failures.length)) {
    console.log(`    ${r.id}: ${[...new Set(r.failures)].join(" | ")}`);
  }
}

const payload = { summary, results };
const stamp = summary.timestamp.replace(/[:.]/g, "-");
writeFileSync(join(RESULTS, `${stamp}.json`), JSON.stringify(payload, null, 2));
writeFileSync(join(RESULTS, "latest.json"), JSON.stringify(payload, null, 2));
await meterSql?.end({ timeout: 5 }).catch(() => {});
console.log(`\n[eval] wrote eval/results/${stamp}.json and latest.json`);

// Non-zero exit when the corpus doesn't pass, so this can gate a change.
process.exit(summary.passed === summary.total ? 0 : 1);
