import { Valyu } from "valyu-js";

/**
 * The DeepResearch (DR) lane. Some MLR features depend on Valyu datasets that
 * are DeepResearch-ONLY (not in the Search API): FDA Device Events (MAUDE),
 * NPI Registry, WHO ICD, CDC Wastewater. Those features MUST run here — async,
 * with the user notified on completion — never faked as a real-time Search.
 *
 * Flow: create() kicks off a task and returns immediately with an id; the
 * client polls status() until `completed`, then renders the report.
 */

let _client: Valyu | null = null;
function client(): Valyu {
  if (!_client) {
    const apiKey = process.env.VALYU_API_KEY;
    if (!apiKey) throw new Error("VALYU_API_KEY is not set");
    _client = new Valyu(apiKey);
  }
  return _client;
}

/** The DR-lane feature kinds — each backed by a DeepResearch-only dataset. */
export type DrKind = "device" | "hcp" | "indication" | "surveillance" | "dossier";

interface KindSpec {
  label: string;
  feature: string;
  dataset: string; // human label of the DeepResearch-only dataset
  buildQuery: (input: string) => string;
}

export const DR_KINDS: Record<DrKind, KindSpec> = {
  // F21 — Medical-device MLR mode
  device: {
    label: "Device adverse events (MAUDE)",
    feature: "F21 — Medical-device MLR",
    dataset: "FDA Device Events (openFDA MAUDE)",
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

/** Kick off a DeepResearch task for a DR-only feature. Returns immediately. */
export async function createDeepResearch(kind: DrKind, input: string): Promise<DrCreateResult> {
  const spec = DR_KINDS[kind];
  const res: any = await client().deepresearch.create({
    query: spec.buildQuery(input),
    // "fast" keeps these targeted lookups quick; DeepResearch reaches the
    // DR-only datasets (MAUDE / NPI / WHO ICD) that Search cannot.
    mode: "fast",
    search: { searchType: "all" },
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
  const res: any = await client().deepresearch.status(taskId);
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
