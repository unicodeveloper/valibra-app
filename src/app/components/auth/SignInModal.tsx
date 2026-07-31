"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/app/stores/auth-store";
import { initiateOAuthFlow, isOAuthConfigured } from "@/lib/oauth";

/**
 * Sign-in dialog.
 *
 * There is no dialog primitive in this app, so this is a self-contained one
 * built from the same surface/line/shadow tokens as the rest of the chrome —
 * the register is "a note laid on the desk", not a SaaS marketing modal. It
 * explains the one thing a reviewer needs to know before signing in: their own
 * Valyu credits pay for the review.
 *
 * Open/close is driven by the auth store so any surface (the masthead control,
 * a 401 from a review) can summon it.
 */
export function SignInModal() {
  const open = useAuthStore((s) => s.showSignInModal);
  const close = useAuthStore((s) => s.closeSignInModal);
  const prompt = useAuthStore((s) => s.signInPrompt);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    // The redirect is imminent once loading starts; closing mid-flight would
    // strand the reviewer on a dialog that's about to be navigated away anyway.
    if (isLoading) return;
    setError(null);
    close();
  }, [isLoading, close]);

  // Escape to dismiss, and lock body scroll while open — the same contract the
  // rest of the app's overlays would follow. Also move focus into the dialog so
  // a keyboard user isn't left behind the overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, handleClose]);

  if (!open) return null;

  const handleSignIn = async () => {
    setError(null);

    // Caught before redirecting so a half-configured deployment gets an
    // explanation here, rather than a confusing bounce to a broken auth screen.
    if (!isOAuthConfigured()) {
      setError(
        "Sign-in isn't configured on this deployment. It needs the Valyu OAuth client " +
          "settings, or it can run in self-hosted mode with the deployment's own API key.",
      );
      return;
    }

    setIsLoading(true);
    try {
      await initiateOAuthFlow(); // navigates away on success
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start sign-in. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div
      className="auth-overlay"
      onClick={handleClose}
      role="presentation"
    >
      <div
        className="auth-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="auth-modal-x" aria-label="Close" onClick={handleClose}>
          ✕
        </button>

        <div className="auth-modal-head">
          <h2 id="auth-modal-title">{prompt?.title ?? "Sign in"}</h2>
        </div>

        <p className="auth-modal-lede">
          {prompt?.lede ??
            "OpenMLR checks every claim against real biomedical evidence through Valyu."}
        </p>

        {error && (
          <div className="err" role="alert">
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
          </div>
        )}

        <button className="auth-modal-cta" onClick={handleSignIn} disabled={isLoading}>
          {isLoading ? (
            <>
              <span className="auth-spinner auth-spinner-sm" aria-hidden="true" />
              Redirecting to Valyu…
            </>
          ) : (
            "Continue with Valyu"
          )}
        </button>

        <p className="hint auth-modal-foot">
          No account yet? You can create one during sign-in.
        </p>
      </div>
    </div>
  );
}
