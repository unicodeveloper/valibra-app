"use client";

import { useEffect, useState } from "react";
import { notifyPermission, requestNotifyPermission } from "../notify";

/**
 * Remembered across mounts.
 *
 * The permission can only be read in an effect (it doesn't exist during SSR), so
 * a fresh mount renders nothing and then pops the button in a tick later. This
 * component sits in the launcher panel of two tabs, which remount on every
 * switch — so that pop became a visible jump each time. After the first read the
 * answer is known synchronously and the first paint is already correct.
 */
let known: NotificationPermission | "unsupported" | null = null;

/**
 * The opt-in for desktop alerts, offered where a run is started — the one moment
 * the ask makes sense, because the reviewer is about to wait minutes for it.
 *
 * Renders nothing once the question is settled: granted needs no control,
 * denied can't be re-asked from the page, and unsupported has nothing to offer.
 * Mounting shows nothing at all until the effect reads the real permission, so
 * the button can't flash on a browser that already answered.
 */
export function NotifyOptIn() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported" | null>(known);

  useEffect(() => {
    known = notifyPermission();
    setPerm(known);
  }, []);

  if (perm !== "default") return null;

  return (
    <button
      className="quiet sm"
      onClick={async () => {
        known = await requestNotifyPermission();
        setPerm(known);
      }}
      title="Get a desktop notification when a report lands, even if you've switched apps"
    >
      Alert me when it&apos;s ready
    </button>
  );
}
