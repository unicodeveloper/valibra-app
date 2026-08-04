import { structured } from "../llm";
import { VerificationSchema, type Claim, type Evidence, type Verification } from "../schemas";

/**
 * F3 — Reference verification (entailment). THE differentiator.
 * Given a claim and the evidence Valyu retrieved, decide whether the evidence
 * actually supports it. The model reasons over supplied evidence only — it never
 * introduces a citation. If nothing supports the claim, it must abstain
 * (verdict "no_evidence"), never bluff.
 */
export function verifyClaim(claim: Claim, evidence: Evidence[]): Promise<Verification> {
  if (evidence.length === 0) {
    return Promise.resolve({
      verdict: "no_evidence",
      confidence: 1,
      rationale: "No supporting source was retrieved for this claim.",
      citedPassage: "",
      citedSourceUrl: "",
    });
  }

  const evidenceBlock = evidence
    .map(
      (e, i) =>
        `[${i + 1}] ${e.title} (${e.source})\nURL: ${e.url}\n${e.snippet}`,
    )
    .join("\n\n---\n\n");

  return structured(VerificationSchema, {
    name: "verification",
    /**
     * The differentiator, and the fan-out — one call per claim, so this is where
     * cost lands. Kept at medium rather than high on that basis: entailment over
     * supplied passages is a narrower judgment than decomposing an asset. At the
     * default `low` the same claim against the same six sources came back
     * 'supported', 'partial' and 'no_evidence' on different runs.
     */
    effort: "medium",
    system:
      "You verify whether retrieved biomedical evidence substantiates a promotional claim. " +
      "Rules you must not break: (1) Judge ONLY against the evidence provided below — never use " +
      "outside knowledge to fill gaps. (2) If the evidence directly conflicts with the claim, " +
      "return 'contradicted'. (3) Cite the exact passage that decides your verdict. (4) Give a " +
      "calibrated confidence in [0,1].\n" +
      "How to weigh support:\n" +
      "- QUALITATIVE effect claims (e.g. 'improves glycemic control', 'lowers LDL', 'is indicated " +
      "for X') → 'supported' if the evidence establishes that effect/indication for the drug OR " +
      "its drug class, even without identical wording. The specific brand name need not appear in " +
      "the evidence — judge the underlying clinical assertion.\n" +
      "- QUANTITATIVE claims (a specific magnitude like 'up to 55%') and COMPARATIVE/superiority " +
      "claims ('more effective than <named drug>') → require evidence that specifically " +
      "substantiates that magnitude or head-to-head comparison. If absent, return 'no_evidence'; " +
      "if the evidence points the other way, 'unsupported' or 'contradicted'.\n" +
      "- If the evidence is silent on the claim's substance, return 'no_evidence' — do NOT bluff.\n" +
      "Reading the excerpts: each source is shown as one or more windows drawn from a longer " +
      "document, separated by '…'. Text outside those windows was not retrieved. So when an excerpt " +
      "is clearly the right source for the claim — the same drug, trial, population and endpoint — " +
      "but some element the claim states (a figure, a statistic, a warning, an instruction, a " +
      "described risk) does not appear in the window, return 'partial' and say what is missing. " +
      "Never treat an excerpt boundary as proof the document lacks it.\n" +
      // The tool graded a sentence of FDA's own approved patient labeling as
      // contradicted because the retrieved label windows didn't happen to include
      // the WARNINGS AND PRECAUTIONS section it came from. Silence in a window is
      // missing text, never a conflict.
      "ABSENCE IS NOT CONFLICT. 'contradicted' requires the evidence to AFFIRMATIVELY STATE " +
      "something incompatible with the claim — a different number, an opposite direction of effect, " +
      "an explicit denial. 'unsupported' requires evidence that addresses the claim's substance and " +
      "fails to bear it out. If your reasoning would be 'the evidence does not mention / does not " +
      "advise / does not include this', that is 'partial' or 'no_evidence' — never 'contradicted' " +
      "or 'unsupported'.\n" +
      // A reference the sponsor supplied is the substantiation an MLR reviewer
      // checks against, but it is also the sponsor's own document. Treating it as
      // self-evidently true would turn the tool into a rubber stamp for whatever
      // was uploaded, which is worse than not having the pack at all.
      "Sources tagged 'reference:<filename>' are documents the REVIEWER supplied as the asset's " +
      "own substantiation, not independently retrieved literature. Read them the same way as any " +
      "other evidence: they support the claim only where they actually state it. If the supplied " +
      "reference does not bear the claim out, say so plainly. When your verdict rests on one, name " +
      "the file in the rationale so the reviewer knows the support is their own document rather " +
      "than the primary literature.\n" +
      // A data-on-file memo confirming "36% lower risk" was enough to drop a
      // claim from critical to warning, because the numbers matched — while the
      // same memo's own limitation paragraph (open-label extension, no concurrent
      // control, descriptive only) went unread. FDA's objection to that claim was
      // never the arithmetic; it was the conclusion drawn from it.
      "A SOURCE'S OWN LIMITATIONS ARE PART OF WHAT IT SAYS. When evidence records a constraint on " +
      "its own data — not prespecified, not controlled for multiplicity, descriptive only, no " +
      "concurrent control, exploratory, must not be presented as establishing something — that " +
      "constraint binds any claim resting on it. Matching figures substantiate a FIGURE; they do " +
      "not substantiate a CONCLUSION the source says its data cannot carry. A claim that presents " +
      "such a result as definitive, proven, or established is NOT supported by that source even " +
      "when every number agrees exactly. Say which limitation the claim runs past.\n" +
      "Special case — the product's own label. When the claim is safety or labeling copy and the " +
      "evidence includes that product's FDA label, the label is the source of truth. Promotional " +
      "safety copy is transcribed from it, so a mismatch is far more likely to be a section we did " +
      "not retrieve than a false statement. Return 'contradicted' only where the label affirmatively " +
      "says otherwise.",
    user:
      `CLAIM (${claim.type}): "${claim.text}"\n\n` +
      `RETRIEVED EVIDENCE:\n${evidenceBlock}\n\n` +
      "Return your entailment verdict.",
  });
}
