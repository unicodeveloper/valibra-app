import type { ReviewResult } from "@/lib/schemas";

/**
 * Work an anonymous visitor has in flight when they hit the sign-up wall, held
 * across the OAuth round-trip so a conversion never costs them their asset — or
 * the free review they just ran. sessionStorage (not local) so it's scoped to
 * the tab and can't linger past the browser session.
 *
 * On sign-in the app restores this and CLAIMS the review into the new account —
 * the free run becomes the reviewer's first saved review, closing the loop.
 */
const KEY = "openmlr_pending_review";

export interface PendingReview {
  assetText: string;
  assetName: string;
  markets: string[];
  /** The completed free-run result, when there is one to claim. */
  result?: ReviewResult;
}

export function stashPendingReview(p: PendingReview): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode / quota — conversion just loses the in-flight work */
  }
}

/** Read without consuming — used to avoid clobbering a stashed result. */
export function peekPendingReview(): PendingReview | null {
  if (typeof window === "undefined") return null;
  try {
    const s = sessionStorage.getItem(KEY);
    return s ? (JSON.parse(s) as PendingReview) : null;
  } catch {
    return null;
  }
}

/** Read and clear — used once on sign-in to restore + claim. */
export function takePendingReview(): PendingReview | null {
  const p = peekPendingReview();
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* nothing to do */
    }
  }
  return p;
}
