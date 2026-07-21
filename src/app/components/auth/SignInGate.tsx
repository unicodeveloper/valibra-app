"use client";

import type { ReactNode } from "react";
import { useAuthStore } from "@/app/stores/auth-store";
import { isValyuMode } from "@/lib/app-mode";

/**
 * Gate a view behind sign-in in valyu mode.
 *
 * Self-hosted has no users, so it never gates — children always render. In
 * valyu mode a signed-out reviewer has no per-account data to show (history and
 * library are scoped to them), so rather than fire requests that 401 and paint
 * an error, we show a quiet prompt to sign in. During session rehydrate we hold
 * a neutral placeholder so an already-signed-in reviewer never sees the prompt
 * flash before the store catches up.
 */
export function SignInGate({ title, children }: { title: string; children: ReactNode }) {
  const { isAuthenticated, isLoading, openSignInModal } = useAuthStore();

  if (!isValyuMode() || isAuthenticated) return <>{children}</>;
  if (isLoading) return <div className="wrap narrow" aria-hidden="true" />;

  return (
    <div className="wrap narrow">
      <div className="empty" style={{ marginTop: 32 }}>
        <h3>{title}</h3>
        <p>Sign in with your Valyu account to continue — your work stays scoped to you.</p>
        <button style={{ marginTop: 14 }} onClick={openSignInModal}>
          Sign in with Valyu
        </button>
      </div>
    </div>
  );
}
