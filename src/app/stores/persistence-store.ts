import { create } from "zustand";
import { authorizedHeaders, handleAuthFailure } from "./auth-store";

export interface ReviewSummary {
  id: string;
  asset_name: string;
  drug_name: string;
  created_at: string;
  finding_count: number;
  decided_count: number;
}

export interface LibEntry {
  drug_name: string;
  claim_text: string;
  claim_type: string;
  verdict: string;
  confidence: number | null;
  status: "provisional" | "confirmed" | "rejected";
}

interface PersistenceState {
  scopeKey: string;
  historyReviews: ReviewSummary[] | null;
  historyPersist: boolean | null;
  historyLoading: boolean;
  historyError: string | null;
  libraryEntries: LibEntry[] | null;
  libraryPersist: boolean | null;
  libraryLoading: boolean;
  libraryError: string | null;
  libraryFilter: string;
  resetForScope: (scopeKey: string) => void;
  loadHistory: (force?: boolean) => Promise<void>;
  loadLibrary: (filter?: string, force?: boolean) => Promise<void>;
  prefetch: () => Promise<void>;
}

let libraryAbort: AbortController | null = null;

function emptyScopedState(scopeKey: string) {
  return {
    scopeKey,
    historyReviews: null,
    historyPersist: null,
    historyLoading: false,
    historyError: null,
    libraryEntries: null,
    libraryPersist: null,
    libraryLoading: false,
    libraryError: null,
    libraryFilter: "",
  };
}

export const usePersistenceStore = create<PersistenceState>()((set, get) => ({
  ...emptyScopedState("initial"),

  resetForScope: (scopeKey) => {
    if (get().scopeKey === scopeKey) return;
    libraryAbort?.abort();
    libraryAbort = null;
    set(emptyScopedState(scopeKey));
  },

  loadHistory: async (force = false) => {
    const state = get();
    if (!force && (state.historyLoading || state.historyReviews)) return;
    const scopeKey = state.scopeKey;

    set({ historyLoading: true, historyError: null });
    try {
      const r = await fetch("/api/reviews", { headers: await authorizedHeaders() });
      const data = await r.json();
      if (handleAuthFailure(r.status, data)) return;
      if (!r.ok) throw new Error(data.error || "Could not load review history.");
      if (get().scopeKey !== scopeKey) return;
      set({
        historyReviews: data.reviews ?? [],
        historyPersist: Boolean(data.persistenceEnabled),
      });
    } catch (e) {
      if (get().scopeKey !== scopeKey) return;
      set({ historyError: e instanceof Error ? e.message : "Could not load review history." });
    } finally {
      if (get().scopeKey === scopeKey) set({ historyLoading: false });
    }
  },

  loadLibrary: async (filter = "", force = false) => {
    const nextFilter = filter.trim();
    const state = get();
    if (
      !force &&
      state.libraryFilter === nextFilter &&
      (state.libraryLoading || state.libraryEntries)
    ) {
      return;
    }

    libraryAbort?.abort();
    const ctl = new AbortController();
    libraryAbort = ctl;
    const scopeKey = state.scopeKey;

    set({ libraryLoading: true, libraryError: null, libraryFilter: nextFilter });
    try {
      const r = await fetch(
        `/api/library${nextFilter ? `?drug=${encodeURIComponent(nextFilter)}` : ""}`,
        { signal: ctl.signal, headers: await authorizedHeaders() },
      );
      const data = await r.json();
      if (handleAuthFailure(r.status, data)) return;
      if (!r.ok) throw new Error(data.error || "Could not load the library.");
      if (get().scopeKey !== scopeKey || libraryAbort !== ctl) return;
      set({
        libraryEntries: data.entries ?? [],
        libraryPersist: Boolean(data.persistenceEnabled),
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (get().scopeKey !== scopeKey || libraryAbort !== ctl) return;
      set({ libraryError: e instanceof Error ? e.message : "Could not load the library." });
    } finally {
      if (get().scopeKey === scopeKey && libraryAbort === ctl) {
        libraryAbort = null;
        set({ libraryLoading: false });
      }
    }
  },

  prefetch: async () => {
    const state = get();
    const work: Promise<void>[] = [];
    if (!state.historyLoading && !state.historyReviews) work.push(get().loadHistory());
    if (!state.libraryLoading && !state.libraryEntries && state.libraryFilter === "") {
      work.push(get().loadLibrary(""));
    }
    await Promise.allSettled(work);
  },
}));
