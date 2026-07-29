"use client";

import { useEffect, useState } from "react";
import { notifyPermission, requestNotifyPermission } from "../notify";

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
  const [perm, setPerm] = useState<NotificationPermission | "unsupported" | null>(null);

  useEffect(() => setPerm(notifyPermission()), []);

  if (perm !== "default") return null;

  return (
    <button
      className="quiet sm"
      onClick={async () => setPerm(await requestNotifyPermission())}
      title="Get a desktop notification when a report lands, even if you've switched apps"
    >
      Alert me when it&apos;s ready
    </button>
  );
}
