import { structured } from "../llm";
import * as valyu from "../valyu";
import { DossierSchema, type Dossier, type Evidence } from "../schemas";

export interface DossierResult {
  drug: string;
  dossier: Dossier;
  sources: { title: string; url: string; source: string }[];
  error: string | null;
}

/**
 * F18 — Deep-research evidence dossier. A one-click, grounded evidence report on
 * a molecule: indication, efficacy, safety, interactions, and evidence gaps —
 * every statement drawn from retrieved Valyu sources, never model memory.
 *
 * (This is the synchronous, retrieval-grounded version. Valyu's async
 * DeepResearch can back a heavier variant later.)
 */
export async function buildDossier(drug: string): Promise<DossierResult> {
  const { evidence, error } = await valyu.gatherDossierEvidence(drug);
  if (evidence.length === 0) {
    return {
      drug,
      dossier: {
        indication: "",
        efficacySummary: "",
        safetySummary: "",
        interactionsSummary: "",
        evidenceGaps: ["No evidence could be retrieved."],
      },
      sources: [],
      error: error || "No evidence retrieved.",
    };
  }

  const evBlock = evidence
    .map((e: Evidence, i: number) => `[${i + 1}] ${e.title} (${e.source})\n${e.url}\n${e.snippet}`)
    .join("\n\n---\n\n");

  const dossier = await structured(DossierSchema, {
    name: "dossier",
    effort: "medium",
    system:
      "You compile an evidence dossier for a drug for MLR/medical reviewers. Use ONLY the supplied " +
      "retrieved sources — never outside knowledge. Summarize the approved indication, key efficacy " +
      "evidence, safety profile (boxed warnings, important ADRs, post-market signals), clinically " +
      "important interactions, and honestly note evidence gaps. Be precise and cite the substance of " +
      "the sources; do not fabricate.",
    user: `DRUG: ${drug}\n\nRETRIEVED SOURCES:\n${evBlock}\n\nCompile the dossier.`,
  });

  return {
    drug,
    dossier,
    sources: evidence.slice(0, 12).map((e) => ({ title: e.title, url: e.url, source: e.source })),
    error: error || null,
  };
}
