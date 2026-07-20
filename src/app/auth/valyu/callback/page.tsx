"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/app/stores/auth-store";
import { OAUTH_KEYS, clearOAuthData } from "@/lib/oauth";

/**
 * OAuth redirect target.
 *
 * Valyu sends the reviewer back here with an authorization code. This page
 * validates the response against the values we stashed before redirecting,
 * exchanges the code for tokens via /api/oauth/token, and hands off to the app.
 *
 * force-dynamic because the whole page is a function of query parameters that
 * only exist at request time; a prerendered shell would be meaningless.
 */
export const dynamic = "force-dynamic";

/** How long an authorization request stays valid. Bounds the replay window. */
const OAUTH_EXPIRY_MS = 10 * 60 * 1000;

/** How long the reviewer reads a message before we send them home. */
const REDIRECT_DELAY_MS = { success: 700, error: 3500 };

function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const signIn = useAuthStore((s) => s.signIn);

  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [message, setMessage] = useState("");

  // React 18+ StrictMode runs effects twice in development. An authorization
  // code is single-use, so a second exchange would fail and show a spurious
  // error over a sign-in that actually succeeded. This latch makes the exchange
  // run exactly once per mount.
  const exchanged = useRef(false);

  useEffect(() => {
    if (exchanged.current) return;
    exchanged.current = true;

    const fail = (text: string) => {
      clearOAuthData();
      setStatus("error");
      setMessage(text);
      setTimeout(() => router.push("/"), REDIRECT_DELAY_MS.error);
    };

    const run = async () => {
      const code = searchParams.get("code");
      const state = searchParams.get("state");
      const error = searchParams.get("error");

      if (error) {
        return fail(
          searchParams.get("error_description") || "Authorisation was declined or failed.",
        );
      }
      if (!code || !state) return fail("This sign-in link is missing its callback parameters.");

      const timestamp = localStorage.getItem(OAUTH_KEYS.timestamp);
      if (!timestamp || Date.now() - Number(timestamp) > OAUTH_EXPIRY_MS) {
        return fail("This sign-in request expired. Please try again.");
      }

      // CSRF check: the state we get back must be the one we generated. If it
      // isn't, someone else's authorization code is being fed to this tab.
      if (state !== localStorage.getItem(OAUTH_KEYS.state)) {
        return fail("Sign-in could not be verified (state mismatch). Please try again.");
      }

      const codeVerifier = localStorage.getItem(OAUTH_KEYS.verifier);
      if (!codeVerifier) {
        return fail("Sign-in data was lost before completion. Please try again.");
      }

      try {
        const response = await fetch("/api/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, codeVerifier }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Token exchange failed.");

        clearOAuthData();

        signIn(
          {
            id: data.user.id,
            name: data.user.name || data.user.email,
            email: data.user.email,
            picture: data.user.picture,
            email_verified: data.user.email_verified,
          },
          {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in,
          },
        );

        setStatus("success");
        setTimeout(() => router.push("/"), REDIRECT_DELAY_MS.success);
      } catch (e) {
        fail(e instanceof Error ? e.message : "Authentication failed.");
      }
    };

    void run();
  }, [searchParams, router, signIn]);

  return (
    <main className="auth-callback">
      <div className="auth-callback-card" role="status" aria-live="polite">
        {status === "processing" && (
          <>
            <div className="auth-spinner" aria-hidden="true" />
            <h1>Signing you in…</h1>
            <p>Completing authentication with Valyu.</p>
          </>
        )}
        {status === "success" && (
          <>
            <div className="auth-glyph auth-glyph-ok" aria-hidden="true">
              ✓
            </div>
            <h1>Signed in</h1>
            <p>Taking you back to your workspace.</p>
          </>
        )}
        {status === "error" && (
          <>
            <div className="auth-glyph auth-glyph-bad" aria-hidden="true">
              ✕
            </div>
            <h1>Sign-in failed</h1>
            <p>{message}</p>
          </>
        )}
      </div>
    </main>
  );
}

export default function ValyuCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="auth-callback">
          <div className="auth-callback-card">
            <div className="auth-spinner" aria-hidden="true" />
            <h1>Loading…</h1>
          </div>
        </main>
      }
    >
      <CallbackInner />
    </Suspense>
  );
}
