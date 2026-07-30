/**
 * Deep-research lane: shared types and labels.
 *
 * These checks can't run inline — their authoritative source is a
 * DeepResearch-only Valyu dataset — so they run async and report back.
 */

export type DrKind = "device" | "hcp" | "indication" | "surveillance" | "dossier";

export interface DrTask {
  /** Valyu's task id. Empty string while a task is still being created — the
   *  poller keys off this being truthy, so an optimistic row is never polled. */
  taskId: string;
  /** Set only on an optimistic row, so the real task can replace exactly it. */
  localId?: string;
  kind: DrKind;
  input: string;
  feature: string;
  dataset: string;
  status: string;
  title: string | null;
  output: string | null;
  sources: { title: string; url: string }[];
  /** Valyu's typeset PDF, when the task rendered one. */
  pdfUrl: string | null;
  error: string | null;
  startedAt: number;
}

export const DR_LABELS: Record<DrKind, string> = {
  device: "Device adverse events",
  hcp: "HCP verification",
  indication: "Indication coding",
  surveillance: "Surveillance / trend",
  dossier: "Deep dossier",
};

export const DR_SOURCE: Record<DrKind, string> = {
  device: "FDA Device Events (MAUDE)",
  hcp: "NPI Registry",
  indication: "WHO ICD",
  surveillance: "CDC surveillance",
  dossier: "All datasets · incl. BindingDB",
};

export const DR_PLACEHOLDER: Record<DrKind, string> = {
  device: "device name (e.g. insulin pump)",
  hcp: "provider name or NPI",
  indication: "condition / indication",
  surveillance: "trend claim (e.g. EGFR-mutant cases are rising)",
  dossier: "drug / molecule (e.g. metformin)",
};

export function isDone(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
