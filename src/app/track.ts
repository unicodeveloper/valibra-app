/**
 * Funnel instrumentation for the free-trial acquisition loop.
 *
 * The events that matter for tuning the trial (where to put the wall, whether
 * the cap is 1 or 2) are wired at their call sites; this is the single place a
 * real analytics SDK gets plugged in. Until one is, events surface in the dev
 * console so the funnel is observable during development.
 *
 *   sample_viewed       — a visitor opened the pre-computed sample
 *   anon_run_completed  — a free (unauthenticated) review finished
 *   wall_shown          — the sign-up wall was raised
 *   review_claimed      — a free review was saved into a new account
 */
export type TrackEvent =
  | "sample_viewed"
  | "anon_run_completed"
  | "wall_shown"
  | "review_claimed";

type Analytics = { track?: (event: string, props: Record<string, unknown>) => void };

export function track(event: TrackEvent, props: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  try {
    // Swap point: e.g. window.posthog?.capture(event, props) or Segment.
    const sdk = (window as unknown as { analytics?: Analytics }).analytics;
    if (sdk?.track) sdk.track(event, props);
    else if (process.env.NODE_ENV !== "production") console.debug("[track]", event, props);
  } catch {
    /* instrumentation must never break the app */
  }
}
