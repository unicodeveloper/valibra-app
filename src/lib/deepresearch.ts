import { type DeepResearchMode } from "valyu-js";
import { valyuDeepResearchCreate, valyuDeepResearchStatus } from "./valyu-credentials";

/**
 * The DeepResearch (DR) lane. Some MLR features depend on Valyu datasets that
 * are DeepResearch-ONLY (not in the Search API): FDA Device Events (MAUDE),
 * NPI Registry, WHO ICD, CDC Wastewater. Those features MUST run here — async,
 * with the user notified on completion — never faked as a real-time Search.
 *
 * Flow: create() kicks off a task and returns immediately with an id; the
 * client polls status() until `completed`, then renders the report.
 */

/**
 * Like the Search lane, both calls below route through the credential context
 * so a signed-in reviewer's DeepResearch task is billed to their own Valyu
 * credits rather than the deployment's key. See src/lib/valyu-credentials.ts.
 */

/** The DR-lane feature kinds — each backed by a DeepResearch-only dataset. */
export type DrKind = "device" | "hcp" | "indication" | "surveillance" | "dossier";

interface KindSpec {
  label: string;
  feature: string;
  dataset: string; // human label of the DeepResearch-only dataset
  /**
   * DeepResearch depth. The targeted lookups (device / hcp / indication /
   * surveillance) each interrogate a single dataset for a specific fact, so
   * "fast" gets there without the reviewer waiting. The dossier synthesizes
   * across every bio dataset, which is the one job "fast" is too shallow for.
   */
  mode: DeepResearchMode;
  buildQuery: (input: string) => string;
}

export const DR_KINDS: Record<DrKind, KindSpec> = {
  // F21 — Medical-device MLR mode
  device: {
    label: "Device adverse events (MAUDE)",
    feature: "F21 — Medical-device MLR",
    dataset: "FDA Device Events (openFDA MAUDE)",
    mode: "fast",
    buildQuery: (d) =>
      `Using FDA MAUDE medical-device adverse-event reports, summarize the reported adverse events, ` +
      `malfunctions, injuries, and safety signals for the medical device "${d}". Identify any signals ` +
      `that a promotional claim of safety or tolerability would need to account for. Cite the reports.`,
  },
  // F22 — HCP verification & transparency
  hcp: {
    label: "HCP verification (NPI)",
    feature: "F22 — HCP verification & transparency",
    dataset: "NPI Registry",
    mode: "fast",
    buildQuery: (h) =>
      `Using the NPI Registry, verify the US healthcare provider "${h}": confirm the NPI number, ` +
      `name, primary taxonomy/specialty, and practice location. Note anything relevant to KOL vetting ` +
      `or Sunshine Act / spend-transparency review. Cite the registry record.`,
  },
  // F23 — Indication-language normalization
  indication: {
    label: "Indication coding (WHO ICD)",
    feature: "F23 — Indication-language normalization",
    dataset: "WHO ICD",
    mode: "fast",
    buildQuery: (c) =>
      `Using WHO ICD classification, map the condition/indication "${c}" to its standardized ICD ` +
      `code(s) and preferred term(s). Flag any mismatch between the promotional phrasing and the ` +
      `coded, approved indication ("indication creep"). Cite the ICD entries.`,
  },
  // F25 — Surveillance-claim checker (CDC Wastewater is DeepResearch-only, so a
  // trend/"cases are rising" claim MUST be checked here, not on the Search lane).
  surveillance: {
    label: "Surveillance / trend (CDC)",
    feature: "F25 — Surveillance-claim checker",
    dataset: "CDC Wastewater / surveillance",
    mode: "fast",
    buildQuery: (claim) =>
      `Using CDC wastewater and public-health surveillance data, assess the surveillance/trend claim: ` +
      `"${claim}". Is the trend (rising/falling incidence or prevalence) supported by current ` +
      `surveillance data? Report the direction and magnitude with dates, and cite the surveillance sources.`,
  },
  // F18 (deep) + F24 depth — a comprehensive DeepResearch dossier that synthesizes
  // across ALL bio datasets, including the DeepResearch-only BindingDB for
  // mechanism/binding-affinity depth (which the Search lane can't reach).
  dossier: {
    label: "Deep dossier (all datasets)",
    feature: "F18 (deep) + F24 — MoA/binding depth",
    dataset: "PubMed · ClinicalTrials · DailyMed · FAERS · Open Targets · BindingDB",
    // Six datasets synthesized into one dossier, and the UI already tells the
    // reviewer this takes minutes — depth is the whole point of this lane.
    mode: "heavy",
    buildQuery: (d) =>
      `Compile a comprehensive evidence dossier for the drug "${d}": (1) approved indication(s); ` +
      `(2) key efficacy evidence from pivotal trials and meta-analyses; (3) safety profile — boxed ` +
      `warnings, important adverse reactions, and post-market (FAERS) signals; (4) clinically ` +
      `important drug interactions; (5) mechanism of action INCLUDING target binding-affinity data ` +
      `(Ki/IC50/Kd from BindingDB) and target-disease genetic evidence. Cite every source and ` +
      `explicitly note evidence gaps.`,
  },
};

export interface DrCreateResult {
  taskId: string;
  status: string;
  kind: DrKind;
  feature: string;
  dataset: string;
}

/**
 * Kick off a DeepResearch task for a DR-only feature. Returns immediately.
 *
 * `alertEmail` is Valyu's own completion notification, and it is the only thing
 * here that reaches a reviewer who has closed the tab. The alternative — a
 * background job polling for them — can't work in valyu mode: a task created
 * through the OAuth proxy belongs to the reviewer's Valyu account, so the
 * deployment's own key cannot read its status (verified: it answers "Not
 * authorized to modify this task"), and polling on their behalf would mean
 * storing refresh tokens server-side. Handing Valyu the address avoids all of
 * that, and avoids this app needing a mail provider at all.
 */
export async function createDeepResearch(
  kind: DrKind,
  input: string,
  alertEmail?: string | null,
): Promise<DrCreateResult> {
  const spec = DR_KINDS[kind];
  const res: any = await valyuDeepResearchCreate({
    query: spec.buildQuery(input),
    // Depth is per-kind — see the `mode` note on KindSpec. DeepResearch is what
    // reaches the DR-only datasets (MAUDE / NPI / WHO ICD / BindingDB) at all.
    mode: spec.mode,
    search: { searchType: "all" },
    ...(alertEmail ? { alertEmail } : {}),
  });
  return {
    taskId: res?.deepresearch_id ?? "",
    status: res?.status ?? "queued",
    kind,
    feature: spec.feature,
    dataset: spec.dataset,
  };
}

export interface DrStatusResult {
  taskId: string;
  status: string; // queued | running | awaiting_input | completed | failed | cancelled
  done: boolean;
  title: string | null;
  output: string | null;
  sources: { title: string; url: string }[];
  error: string | null;
}

/** Poll a DeepResearch task. The client calls this until `done` is true. */
export async function getDeepResearchStatus(taskId: string): Promise<DrStatusResult> {
  const res: any = await valyuDeepResearchStatus(taskId);
  const status: string = res?.status ?? "running";
  const done = status === "completed" || status === "failed" || status === "cancelled";
  const output =
    typeof res?.output === "string"
      ? res.output
      : res?.output
        ? JSON.stringify(res.output, null, 2)
        : null;
  const sources = Array.isArray(res?.sources)
    ? res.sources.map((s: any) => ({ title: s?.title ?? s?.url ?? "source", url: s?.url ?? "" }))
    : [];
  return {
    taskId,
    status,
    done,
    title: res?.title ?? null,
    output,
    sources,
    error: res?.error ?? null,
  };
}
