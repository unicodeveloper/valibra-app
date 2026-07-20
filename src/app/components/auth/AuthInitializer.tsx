"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/app/stores/auth-store";

/**
 * Rehydrates the auth session once, after mount.
 *
 * This is a component rather than a call inside layout because rehydration
 * reads localStorage, which only exists in the browser — doing it during render
 * (server included) would desync the hydrated markup. An effect runs
 * client-only, after paint, which is exactly when the stored session should be
 * adopted.
 *
 * Renders nothing itself; it wraps the tree so the effect has somewhere to live.
 */
export function AuthInitializer({ children }: { children: React.ReactNode }) {
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return <>{children}</>;
}
