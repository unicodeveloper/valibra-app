/**
 * Desktop notifications for finished deep-research runs.
 *
 * The third rung of the ladder: the in-app toast reaches someone already on the
 * page, the title badge reaches someone on another tab in the same browser, and
 * this reaches someone who has switched to a different application entirely. It
 * still dies with the tab — the completion email is what covers a closed browser.
 *
 * Permission is never requested on load. A prompt nobody asked for is the fastest
 * way to a permanent "denied", which cannot be undone from the page — so it is
 * requested only from an explicit control, at the moment someone is about to
 * start a run they'll be waiting minutes for.
 */

export function notifySupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notifyPermission(): NotificationPermission | "unsupported" {
  return notifySupported() ? Notification.permission : "unsupported";
}

export async function requestNotifyPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notifySupported()) return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    // Older Safari hands back a callback-style API that rejects here; treat a
    // failed ask as "not granted" rather than letting it break the click.
    return "denied";
  }
}

/**
 * Raise one notification for a finished task. Silent unless permission is
 * already granted and the reviewer is looking at something else — notifying
 * someone who is watching the page is just noise on top of the toast.
 */
export function notifyReportReady(opts: {
  title: string;
  body: string;
  /** Task id, so a re-poll of the same task replaces rather than stacks. */
  tag: string;
  onClick: () => void;
}): void {
  if (!notifySupported() || Notification.permission !== "granted") return;
  if (typeof document !== "undefined" && document.visibilityState === "visible") return;

  try {
    const n = new Notification(opts.title, { body: opts.body, tag: opts.tag });
    n.onclick = () => {
      window.focus();
      opts.onClick();
      n.close();
    };
  } catch {
    /* Some browsers require a service worker for this constructor. Losing the
       notification must never cost the reviewer the toast or the badge. */
  }
}
