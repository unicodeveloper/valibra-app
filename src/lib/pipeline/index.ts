import { randomUUID } from "node:crypto";
import * as valyu from "../valyu";
import type {
  AuditEntry,
  Evidence,
  Finding,
  ReviewResult,
  Severity,
  Verification,
} from "../schemas";
import { extractClaims } from "./extract";
import { verifyClaim } from "./verify";
import { checkFairBalance } from "./fairbalance";
import { profileAsset, fairBalanceApplies, safetyOmissionApplies, profileSummary } from "./assetProfile";
import { checkOffLabel } from "./offlabel";
import { checkCitationQuality } from "./citationQuality";
import { checkAdverseEvents } from "./adverseEvents";
import { checkSafetyOmission } from "./safetyOmission";
import { checkInteractions } from "./interactions";
import { groundRegulatory } from "./regulatory";
import { checkComparative } from "./comparative";
import { checkIp, noveltyClaims } from "./ipCheck";
import { checkMarketClaims, marketClaims } from "./marketClaim";
import { listLibrary, type LibraryEntry, type Owner } from "../db/client";
import { searchPack } from "../references";
import { embed, cosineSim } from "../llm";
import type { Claim } from "../schemas";

/** Normalize a claim for library matching (F16 reuse): lowercase, collapse ws, drop trailing punctuation. */
function normalizeClaim(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
}

type LibMatch = {
  verdict: string;
  savedAt: string;
  similarity: number;
  matchedText: string;
  status: string;
};
const SEMANTIC_THRESHOLD = 0.85; // cosine cutoff for text-embedding-3-small paraphrase matches

function savedAtStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return typeof v === "string" ? v : String(v);
}

/**
 * F16 v2 — match review claims to the library: exact normalized text first, then
 * semantic (cosine ≥ threshold) so paraphrased prior claims still reuse. Semantic
 * matching is best-effort; on embed failure it silently falls back to exact-only.
 *
 * A claim a reviewer rejected is never reused — dropping those here keeps a
 * human "no" authoritative over the pipeline's earlier "supported".
 */
async function buildLibraryMatcher(
  claims: Claim[],
  allEntries: LibraryEntry[],
): Promise<Map<string, LibMatch>> {
  const out = new Map<string, LibMatch>();
  const entries = allEntries.filter((e) => e.status !== "rejected");
  if (entries.length === 0) return out;

  // Confirmed entries win a text collision: same claim, human-reviewed version.
  const byNorm = new Map<string, LibraryEntry>();
  for (const e of entries) {
    const k = normalizeClaim(e.claim_text);
    const prev = byNorm.get(k);
    if (!prev || (prev.status !== "confirmed" && e.status === "confirmed")) byNorm.set(k, e);
  }

  const unmatched: Claim[] = [];
  for (const c of claims) {
    const e = byNorm.get(normalizeClaim(c.text));
    if (e) {
      out.set(c.id, {
        verdict: e.verdict,
        savedAt: savedAtStr(e.created_at),
        similarity: 1,
        matchedText: e.claim_text,
        status: e.status,
      });
    } else {
      unmatched.push(c);
    }
  }

  const embedded = entries.filter((e) => Array.isArray(e.embedding) && e.embedding.length > 0);
  if (unmatched.length === 0 || embedded.length === 0) return out;

  try {
    const vecs = await embed(unmatched.map((c) => c.text));
    unmatched.forEach((c, i) => {
      let best: LibraryEntry | null = null;
      let bestSim = 0;
      for (const e of embedded) {
        const sim = cosineSim(vecs[i], e.embedding as number[]);
        if (sim > bestSim) {
          bestSim = sim;
          best = e;
        }
      }
      if (best && bestSim >= SEMANTIC_THRESHOLD) {
        out.set(c.id, {
          verdict: best.verdict,
          savedAt: savedAtStr(best.created_at),
          similarity: bestSim,
          matchedText: best.claim_text,
          status: best.status,
        });
      }
    });
  } catch (e) {
    console.error("semantic library match failed (exact-only):", e);
  }
  return out;
}

/**
 * Phase 0 orchestrator — the substantiation spine.
 *
 *   ingest → F1 extract → F2 substantiate → F3 verify
 *          → F5 fair-balance (vs live DailyMed) → F6 off-label
 *          → assemble findings + audit trail (F15/F17)
 *
 * Every step appends to the audit trail. Human review happens on top of the
 * returned findings — this is decision support, never an autonomous
 * regulatory determination.
 */
export async function runReview(
  assetText: string,
  assetName: string,
  markets: string[] = ["US"],
  // Whose claims library this review may reuse — the signed-in reviewer in
  // valyu mode, null (global) in self-hosted. Scopes the F16 read below so a
  // "similar claim already substantiated" badge never sources another tenant.
  owner: Owner = null,
  onProgress?: (entry: AuditEntry) => void,
  /**
   * The reviewer's own approved source documents, if they supplied a pack.
   *
   * Scoped deliberately narrowly: this feeds CLAIM SUBSTANTIATION only. Label,
   * FAERS, interaction and patent checks stay on live retrieval whatever is in
   * the pack, because someone uploading last year's PI must not be able to move
   * what the off-label detector believes the approved indication is.
   */
  referencePackId: string | null = null,
): Promise<ReviewResult> {
  const reviewId = randomUUID();
  const audit: AuditEntry[] = [];
  const log = (step: string, detail: string) => {
    const entry: AuditEntry = { ts: new Date().toISOString(), step, detail };
    audit.push(entry);
    // A review fans out across dozens of Valyu + LLM calls and takes tens of
    // seconds. The audit trail already knows where we are; streaming it lets the
    // reviewer watch the real pipeline instead of a spinner.
    onProgress?.(entry);
  };

  log("ingest", `Asset "${assetName}" received (${assetText.length} chars).`);
  if (referencePackId) log("references", "Reviewer reference pack supplied; claims check against it first.");

  // Clear the retrieval circuit breaker so a previous run's credit failure can't
  // short-circuit this one.
  valyu.beginRetrievalRun();

  // F1 — extract claims + drug
  const { drugName, claims } = await extractClaims(assetText);
  log("extract", `Found ${claims.length} claim(s); drug = ${drugName || "(none)"}.`);

  const retrievalErrors = new Set<string>();

  // ---- WAVE 1: fetch all drug-scoped data up front, in parallel ----
  // Label (F5/F6/F8 + on-label substantiation), FAERS (F7), interactions (F19)
  // all depend only on drugName, so fire them together.
  const [labelRes, faersRes, interactionRes, libraryEntries, profileRes] = await Promise.all([
    drugName ? valyu.getLabel(drugName) : Promise.resolve({ evidence: [], error: null }),
    drugName ? valyu.getAdverseEvents(drugName) : Promise.resolve({ evidence: [], error: null }),
    drugName ? valyu.getInteractions(drugName) : Promise.resolve({ evidence: [], error: null }),
    drugName ? listLibrary(drugName, owner).catch(() => []) : Promise.resolve([]), // F16 reuse
    // What kind of asset this is — gates F5/F8 below. Independent of the drug, so
    // it rides along here rather than adding a step. A classification failure is
    // non-fatal: the gates fall back to running the checks.
    profileAsset(assetText).catch((e) => {
      console.error("asset profiling failed (checks ungated):", e);
      return null;
    }),
  ]);
  for (const e of [faersRes.error, interactionRes.error]) if (e) retrievalErrors.add(e);

  const assetProfile = profileRes;
  if (assetProfile) log("profile", profileSummary(assetProfile));

  // F16 reuse — match claims against the library (exact text, then semantic).
  // Kicked off here so its embedding call overlaps wave 2's LLM work.
  if (libraryEntries.length) log("library", `${libraryEntries.length} prior claim(s) available for reuse.`);
  const libraryMatchesP = buildLibraryMatcher(claims, libraryEntries);

  // Resolve the label with the match guard (don't act on the wrong drug's label).
  let label: Evidence[] = [];
  if (!drugName) {
    log("label", "No drug identified; skipping label-dependent checks.");
  } else if (labelRes.error) {
    retrievalErrors.add(labelRes.error);
    log("label", `Label retrieval failed for ${drugName}: ${labelRes.error}`);
  } else if (labelRes.evidence.length && !valyu.labelMatchesDrug(drugName, labelRes.evidence)) {
    retrievalErrors.add(
      `No DailyMed label matching "${drugName}" was found — fair balance and off-label were not checked.`,
    );
    log("label", `Retrieved label did NOT match ${drugName}; discarding for F5/F6.`);
  } else {
    label = labelRes.evidence;
    const hasInd = label.some((e) => /is indicated|indications and usage|improve glycemic/i.test(e.snippet));
    log("label", `Retrieved ${label.length} matching DailyMed excerpt(s) for ${drugName}. indication-in-label=${hasInd}`);
  }

  // ---- WAVE 2: every per-claim and analysis check runs concurrently ----
  // Claim types the retrieved label can substantiate directly.
  //
  // "safety" belongs here and was missing. Safety copy in a promotional asset —
  // an ISI above all — is transcribed from the SPL, so the label IS its source
  // of truth. Leaving it out meant those claims were judged only against
  // whatever a generic DailyMed/FAERS query happened to rerank, and an ISI line
  // lifted verbatim from ADVERSE REACTIONS could come back unsubstantiated
  // while the very section that substantiates it sat unused in `label`.
  const onLabelTypes = new Set(["efficacy", "indication", "dosing", "safety"]);
  const substantiation: ReviewResult["substantiation"] = {};

  // Surveillance/trend claims can't be substantiated on the Search lane — their
  // authoritative source (CDC Wastewater) is DeepResearch-only. Route them to
  // the DR lane instead of faking it with a Search query.
  const deepResearchRequired: ReviewResult["deepResearchRequired"] = [];
  const inlineClaims = claims.filter((c) => {
    if (c.type === "surveillance") {
      deepResearchRequired.push({
        kind: "surveillance",
        input: c.text,
        feature: "F25 — Surveillance-claim checker",
        reason: "Trend/surveillance claim — its authoritative source (CDC surveillance) is DeepResearch-only.",
      });
      return false;
    }
    return true;
  });

  const claimTasks = Promise.all(
    inlineClaims.map(async (claim) => {
      // The reviewer's own references first: the asset was written from them, so
      // they are the substantiation an MLR reviewer would actually check against.
      // Retrieval then adds the independent view.
      const packEvidence = referencePackId
        ? await searchPack(referencePackId, claim.text).catch((e) => {
            console.error("reference pack search failed:", e);
            return [];
          })
        : [];

      const { evidence, error } = await valyu.substantiate(
        claim.searchQuery || claim.text,
        claim.type,
        claim.text,
      );
      if (error) {
        retrievalErrors.add(error);
        // Do NOT run entailment on a failed search — that would abstain as if
        // we had searched. Mark it un-checked.
        substantiation[claim.id] = {
          evidence,
          error,
          verification: {
            verdict: "no_evidence",
            confidence: 0,
            rationale: `Evidence retrieval failed — claim not checked: ${error}`,
            citedPassage: "",
            citedSourceUrl: "",
          },
        };
        return;
      }
      // Captured BEFORE label excerpts and pack hits are added: this records what
      // the SEARCH found, which is what the reviewer needs to know. A pack hit
      // does not mean retrieval succeeded.
      const noSourcesRetrieved = evidence.length === 0;
      const evidenceForVerify = [
        ...packEvidence,
        ...(onLabelTypes.has(claim.type) && label.length ? [...evidence, ...label] : evidence),
      ];
      const verification = await verifyClaim(claim, evidenceForVerify);
      substantiation[claim.id] = {
        evidence: evidenceForVerify,
        verification,
        error: null,
        noSourcesRetrieved,
      };
    }),
  );

  const safetyClaims = claims.filter((c) => c.type === "safety" || c.type === "comparative");
  const comparativeClaims = claims.filter((c) => c.type === "comparative");
  const novClaims = noveltyClaims(claims);
  const mktClaims = marketClaims(claims);

  // F5/F8 are promotional-materials rules. Gate them on what the asset actually
  // is — and skip the call entirely rather than running it and discarding the
  // answer, so a labeling excerpt doesn't pay for a judgment that cannot apply.
  const runFairBalance = fairBalanceApplies(assetProfile);
  const runSafetyOmission = safetyOmissionApplies(assetProfile);
  if (!runFairBalance)
    log("fair-balance", `Skipped — not a promotional piece with benefit claims (kind=${assetProfile?.kind}).`);
  if (!runSafetyOmission)
    log("safety-omission", `Skipped — not a piece required to carry the boxed warning (kind=${assetProfile?.kind}).`);

  const [, fairBalance, offLabel, adverseEvents, safetyOmission, interactions, comparativeR, ipR, marketR] =
    await Promise.all([
      claimTasks, // F2 + F3
      runFairBalance ? checkFairBalance(assetText, label) : Promise.resolve(null), // F5
      checkOffLabel(claims, label), // F6
      checkAdverseEvents(safetyClaims, faersRes.evidence), // F7
      runSafetyOmission ? checkSafetyOmission(assetText, label) : Promise.resolve(null), // F8
      checkInteractions(claims, interactionRes.evidence), // F19
      checkComparative(comparativeClaims, drugName), // F10 (self-skips if none)
      checkIp(novClaims, drugName), // F11 (self-skips if none)
      checkMarketClaims(mktClaims, drugName), // F12 (self-skips if none)
    ]);
  const comparative = comparativeR.result;
  const ip = ipR.result;
  const marketClaim = marketR.result;
  for (const e of [comparativeR.error, ipR.error, marketR.error]) if (e) retrievalErrors.add(e);

  log("verify", `${Object.keys(substantiation).length} claim(s) verified.`);
  if (fairBalance) log("fair-balance", fairBalance.balanced ? "Balanced." : "Fair-balance issue flagged.");
  log("off-label", `Status: ${offLabel.status}; ${offLabel.offLabelClaims.length} flagged claim(s).`);
  log("adverse-events", `${adverseEvents.contradictions.length} FAERS contradiction(s).`);
  if (safetyOmission)
    log("safety-omission", `${safetyOmission.omittedBoxedWarnings.length} boxed + ${safetyOmission.omittedContraindications.length} contraindication omission(s).`);
  log("interactions", `${interactions.findings.length} interaction finding(s).`);
  log("comparative", `${comparative.findings.length} comparative claim(s) assessed.`);
  log("ip", `${ip.findings.length} novelty/IP claim(s) assessed.`);
  log("market-claim", `${marketClaim.findings.length} market claim(s) assessed.`);

  // F4 — citation quality (pure, over the evidence already retrieved)
  const evidenceByClaim: Record<string, Evidence[]> = {};
  for (const [cid, s] of Object.entries(substantiation)) evidenceByClaim[cid] = s.evidence;
  const citationFindings = checkCitationQuality(claims, evidenceByClaim);
  log("citation-quality", `${citationFindings.length} weak-citation finding(s).`);

  // F9 — regulatory grounding of the review's concerns (OPDP precedent + guidance)
  const concerns: string[] = [];
  if (offLabel.status === "off_label" && offLabel.offLabelClaims.length)
    concerns.push("off-label promotion (claims beyond the approved indication)");
  if (fairBalance && !fairBalance.balanced && fairBalance.hasSafetyContext)
    concerns.push("inadequate fair balance / omission of required safety information");
  if (Object.values(substantiation).some((s) => s.verification.verdict === "unsupported"))
    concerns.push("unsupported efficacy claim");
  if (adverseEvents.contradictions.length)
    concerns.push("safety/tolerability claim inconsistent with post-market adverse events");
  if (comparative.findings.some((f) => f.verdict === "no_head_to_head" || f.verdict === "contradicted"))
    concerns.push("comparative/superiority claim lacking head-to-head evidence");

  let regulatory: ReviewResult["regulatory"] = null;
  if (concerns.length) {
    const g = await groundRegulatory(drugName, concerns, markets); // F14: markets
    if (g.error) retrievalErrors.add(g.error);
    regulatory = g.result;
    log("regulatory", `${regulatory.groundings.length} concern(s) grounded (${markets.join("/")}).`);
  }

  // F26 — provenance / licensed-evidence trust badge.
  //
  // Reviewer-supplied passages are counted SEPARATELY from licensed sources.
  // Folding them into one number would let a pack inflate the badge and overstate
  // how much independent grounding a review actually had, which is the opposite
  // of what this badge is for.
  const datasets = new Set<string>();
  let sourceCount = 0;
  let referenceCount = 0;
  for (const s of Object.values(substantiation)) {
    for (const e of s.evidence) {
      if (e.source?.startsWith("reference:")) {
        referenceCount++;
        continue;
      }
      if (e.source) datasets.add(e.source);
      sourceCount++;
    }
  }
  const provenance: ReviewResult["provenance"] = {
    datasets: [...datasets].sort(),
    sourceCount,
    referenceCount,
    markets,
    note: "Grounded in licensed / authoritative sources via Valyu (SOC 2 · ISO 27001 · GDPR · zero data retention).",
  };
  log(
    "provenance",
    `${datasets.size} dataset(s), ${sourceCount} licensed source(s)` +
      (referenceCount ? `, ${referenceCount} passage(s) from your references.` : "."),
  );
  if (deepResearchRequired.length)
    log("deep-research", `${deepResearchRequired.length} check(s) require the DeepResearch lane.`);

  const libraryMatches = await libraryMatchesP;
  if (libraryMatches.size) log("library", `${libraryMatches.size} claim(s) matched prior substantiations.`);

  const findings = assembleFindings(claims, substantiation, fairBalance, offLabel, {
    adverseEvents,
    safetyOmission,
    interactions,
    regulatory,
    citationFindings,
    comparative,
    ip,
    marketClaim,
    libraryMatches,
  });
  log("assemble", `${findings.length} finding(s) surfaced for review.`);

  // A credit failure is reported once, as its own state — not mixed into the
  // list of thin-evidence problems, where it would read as a retrieval quirk.
  const retrievalHalt = valyu.retrievalHalt();
  if (retrievalHalt) {
    for (const e of [...retrievalErrors]) if (valyu.isCreditError(e)) retrievalErrors.delete(e);
    log("retrieval", `Halted — ${retrievalHalt} Remaining searches were skipped.`);
  }
  if (retrievalErrors.size) {
    log("retrieval", `Retrieval problems: ${[...retrievalErrors].join(" | ")}`);
  }

  return {
    reviewId,
    assetName,
    assetText,
    drugName,
    claims,
    substantiation,
    assetProfile,
    fairBalance,
    offLabel,
    adverseEvents,
    safetyOmission,
    interactions,
    regulatory,
    comparative,
    ip,
    marketClaim,
    provenance,
    deepResearchRequired,
    findings,
    retrievalErrors: [...retrievalErrors],
    retrievalHalt,
    audit,
  };
}

/** Map a specialized claim type to its own finding category (F13/F20/F24/F25). */
function claimCategory(type: string): Finding["category"] {
  switch (type) {
    case "mechanism":
      return "mechanism";
    case "epidemiology":
      return "epidemiology";
    case "biomarker":
      return "biomarker";
    case "surveillance":
      return "surveillance";
    default:
      return "substantiation";
  }
}

/**
 * Reviewer-facing headline per verdict.
 *
 * The raw enum interpolated into a sentence ("Claim no evidence") reads as if
 * nothing was retrieved, which is wrong and alarming when the claim was checked
 * against a dozen sources — `no_evidence` means the retrieved evidence does not
 * speak to the claim, i.e. the pipeline abstained rather than bluffing.
 */
const VERDICT_HEADLINE: Record<Verification["verdict"], string> = {
  supported: "Claim supported by the evidence",
  partial: "Claim only partly supported",
  unsupported: "Claim not supported by the evidence",
  contradicted: "Claim contradicted by the evidence",
  no_evidence: "Not substantiated by any retrieved source",
};

/**
 * Grade a verdict.
 *
 * `no_evidence` is deliberately NOT critical. It says the retrieved sources
 * don't speak to the claim — which is a statement about our retrieval, not a
 * defect in the copy. Grading it critical meant any asset whose references live
 * outside our datasets (approved patient labeling, an ISI transcribed from the
 * SPL, a claim cited to the sponsor's own data on file) came back as a wall of
 * red. It gets its own tier so the reviewer can act on it — attach the
 * reference — without it competing with real defects.
 */
function verdictSeverity(v: Verification["verdict"]): Severity {
  switch (v) {
    case "contradicted":
    case "unsupported":
      return "critical";
    case "no_evidence":
      return "unverified";
    case "partial":
      return "warning";
    case "supported":
    default:
      return "info";
  }
}

interface Phase1Inputs {
  adverseEvents: ReviewResult["adverseEvents"];
  safetyOmission: ReviewResult["safetyOmission"];
  interactions: ReviewResult["interactions"];
  regulatory: ReviewResult["regulatory"];
  citationFindings: Finding[];
  comparative: ReviewResult["comparative"];
  ip: ReviewResult["ip"];
  marketClaim: ReviewResult["marketClaim"];
  libraryMatches: Map<string, LibMatch>;
}

function assembleFindings(
  claims: ReviewResult["claims"],
  substantiation: ReviewResult["substantiation"],
  fairBalance: ReviewResult["fairBalance"],
  offLabel: ReviewResult["offLabel"],
  p1: Phase1Inputs,
): Finding[] {
  const findings: Finding[] = [];
  const claimById = new Map(claims.map((c) => [c.id, c]));

  // Substantiation / verification findings
  for (const claim of claims) {
    const s = substantiation[claim.id];
    if (!s) continue;
    const { verification, evidence, error } = s;
    // A failed search is "not checked", not "unsubstantiated" — it belongs in
    // the unverified tier alongside abstentions, never among the defects.
    const isSearchError = Boolean(error);
    // Search ran, returned nothing, and nothing else spoke to the claim either.
    // Say so plainly: "we found no source" is a different message to the
    // reviewer than "the sources we found don't support this", and only the
    // first one means the tool effectively did not look.
    const foundNothing =
      !isSearchError && s.noSourcesRetrieved === true && verification.verdict === "no_evidence";
    findings.push({
      id: `sub-${claim.id}`,
      category: claimCategory(claim.type),
      severity: isSearchError || foundNothing ? "unverified" : verdictSeverity(verification.verdict),
      claimId: claim.id,
      claimText: claim.text,
      headline: isSearchError
        ? "Not checked — evidence retrieval failed"
        : foundNothing
          ? "No source found — this claim was not checked against evidence"
          : VERDICT_HEADLINE[verification.verdict],
      detail: foundNothing
        ? "The literature search returned no results for this claim, so nothing was " +
          "assessed. This is a gap in what the search could reach, not a finding " +
          "against the claim — attach your own reference to substantiate it."
        : verification.rationale,
      confidence: isSearchError ? null : verification.confidence,
      evidence,
      libraryMatch: p1.libraryMatches.get(claim.id) ?? null,
    });
  }

  // Off-label findings (per flagged claim)
  if (offLabel) {
    for (const off of offLabel.offLabelClaims) {
      const claim = claimById.get(off.claimId);
      findings.push({
        id: `off-${off.claimId}`,
        category: "off-label",
        severity: "critical",
        claimId: off.claimId,
        claimText: claim?.text ?? null,
        headline: "Potential off-label promotion",
        detail: off.why,
        confidence: null,
        evidence: [],
      });
    }
  }

  // Fair-balance finding (asset-level)
  if (fairBalance && !fairBalance.balanced) {
    findings.push({
      id: "fair-balance",
      category: "fair-balance",
      severity: fairBalance.hasSafetyContext ? "critical" : "warning",
      claimId: null,
      claimText: null,
      headline: fairBalance.hasSafetyContext
        ? "Fair-balance / missing safety information"
        : "Fair balance could not be assessed",
      detail:
        fairBalance.rationale +
        (fairBalance.missingSafetyInfo.length
          ? `\n\n**Missing safety items:**\n${fairBalance.missingSafetyInfo.map((m) => `- ${m}`).join("\n")}`
          : ""),
      confidence: null,
      evidence: [],
    });
  }

  // F7 — adverse-event contradictions
  if (p1.adverseEvents) {
    for (const c of p1.adverseEvents.contradictions) {
      findings.push({
        id: `ae-${c.claimId}`,
        category: "adverse-event",
        severity: "critical",
        claimId: c.claimId,
        claimText: claimById.get(c.claimId)?.text ?? null,
        headline: "Safety claim contradicted by adverse-event data",
        detail: `**FAERS signal:** ${c.signal}\n\n${c.why}`,
        confidence: null,
        evidence: [],
      });
    }
  }

  // F8 — omitted boxed warnings / contraindications
  if (p1.safetyOmission) {
    const { omittedBoxedWarnings, omittedContraindications } = p1.safetyOmission;
    if (omittedBoxedWarnings.length || omittedContraindications.length) {
      const parts: string[] = [];
      if (omittedBoxedWarnings.length)
        parts.push(`**Omitted boxed warnings:**\n${omittedBoxedWarnings.map((m) => `- ${m}`).join("\n")}`);
      if (omittedContraindications.length)
        parts.push(
          `**Omitted contraindications:**\n${omittedContraindications.map((m) => `- ${m}`).join("\n")}`,
        );
      findings.push({
        id: "safety-omission",
        category: "safety-omission",
        severity: "critical",
        claimId: null,
        claimText: null,
        headline: "Required safety element omitted",
        detail: parts.join("\n\n"),
        confidence: null,
        evidence: [],
      });
    }
  }

  // F19 — drug-interaction conflicts
  if (p1.interactions) {
    for (const f of p1.interactions.findings) {
      findings.push({
        id: `int-${f.claimId}`,
        category: "drug-interaction",
        severity: "warning",
        claimId: f.claimId,
        claimText: claimById.get(f.claimId)?.text ?? null,
        headline: `Drug-interaction issue (${f.verdict})`,
        detail: f.why,
        confidence: null,
        evidence: [],
      });
    }
  }

  // F10 — comparative / superiority (needs head-to-head)
  if (p1.comparative) {
    for (const f of p1.comparative.findings) {
      if (f.verdict === "head_to_head_supported") continue;
      findings.push({
        id: `cmp-${f.claimId}`,
        category: "comparative",
        severity: f.verdict === "contradicted" ? "critical" : "warning",
        claimId: f.claimId,
        claimText: claimById.get(f.claimId)?.text ?? null,
        headline: `Comparative claim: ${f.verdict.replace(/_/g, " ")}`,
        detail: `**Comparator:** ${f.comparator || "(unspecified)"}\n\n${f.why}`,
        confidence: null,
        evidence: [],
      });
    }
  }

  // F11 — IP / first-in-class / novelty
  if (p1.ip) {
    for (const f of p1.ip.findings) {
      if (f.verdict === "supported") continue;
      findings.push({
        id: `ip-${f.claimId}`,
        category: "ip",
        severity: "warning",
        claimId: f.claimId,
        claimText: claimById.get(f.claimId)?.text ?? null,
        headline: `Novelty/IP claim ${f.verdict.replace(/_/g, " ")}`,
        detail: f.why,
        confidence: null,
        evidence: [],
      });
    }
  }

  // F12 — market-position claims
  if (p1.marketClaim) {
    for (const f of p1.marketClaim.findings) {
      if (f.verdict === "supported") continue;
      findings.push({
        id: `mkt-${f.claimId}`,
        category: "market-claim",
        severity: "warning",
        claimId: f.claimId,
        claimText: claimById.get(f.claimId)?.text ?? null,
        headline: `Market claim ${f.verdict.replace(/_/g, " ")}`,
        detail: f.why,
        confidence: null,
        evidence: [],
      });
    }
  }

  // F4 — weak citation quality (already-built findings)
  findings.push(...p1.citationFindings);

  // F9 — regulatory grounding (informational; strengthens the flags above)
  if (p1.regulatory) {
    for (const g of p1.regulatory.groundings) {
      findings.push({
        id: `reg-${findings.length}`,
        category: "regulatory",
        severity: "info",
        claimId: null,
        claimText: null,
        headline: `Precedent: ${g.concern}`,
        detail: `**${g.guidanceOrPrecedent}**\n\n${g.why}${g.sourceUrl ? `\n\n[Source](${g.sourceUrl})` : ""}`,
        confidence: null,
        evidence: [],
      });
    }
  }

  // Most severe first. Unverified sorts below the defects and above the
  // supported claims — it's work for the reviewer, not a finding against the copy.
  const rank: Record<Severity, number> = { critical: 0, warning: 1, unverified: 2, info: 3 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
