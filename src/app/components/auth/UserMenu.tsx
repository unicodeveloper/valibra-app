"use client";

import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/app/stores/auth-store";
import { isValyuMode } from "@/lib/app-mode";

/**
 * Masthead auth control.
 *
 * Two states, one slot beside the theme control:
 *   signed out — a compact "Sign in" button that opens the modal.
 *   signed in  — the reviewer's avatar; clicking it drops a small card with
 *                their identity and a sign-out action.
 *
 * Renders nothing at all in self-hosted mode: there is no user there, so a
 * sign-in affordance would be a dead control. The check is `isValyuMode()`
 * rather than `!isSelfHostedMode()` so the intent — "only when we expect users"
 * — reads directly.
 */
export function UserMenu() {
  const { user, isAuthenticated, isLoading, signOut, openSignInModal } = useAuthStore();
  const [open, setOpen] = useState(false);
  // An avatar URL from an OIDC `picture` claim is arbitrary and may 404 or be
  // hotlink-blocked; when it fails to load we drop to the initial rather than
  // leave the browser's broken-image glyph. Reset per URL so a new sign-in with
  // a working picture isn't suppressed by a previous one's failure.
  const [avatarFailed, setAvatarFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setAvatarFailed(false), [user?.picture]);

  // Dismiss the dropdown on an outside click, the same way any menu in this app
  // would behave. Bound only while open so we're not listening needlessly.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!isValyuMode()) return null;

  // Hold the slot during rehydration so the masthead doesn't jump when the
  // session resolves a beat after first paint.
  if (isLoading) return <div className="auth-slot" aria-hidden="true" />;

  if (!isAuthenticated || !user) {
    return (
      <button className="ghost sm auth-signin" onClick={() => openSignInModal()}>
        Sign in
      </button>
    );
  }

  const initial = (user.name || user.email || "U").charAt(0).toUpperCase();

  return (
    <div className="auth-slot" ref={rootRef}>
      <button
        className="auth-avatar-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        onClick={() => setOpen((v) => !v)}
      >
        {user.picture && !avatarFailed ? (
          // Plain img, not next/image: the source is an arbitrary external
          // avatar URL and this avoids threading remote-image config for one
          // 30px picture. no-referrer so avatar CDNs (Google, GitHub) that
          // reject cross-origin hotlinks by Referer still serve the image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="auth-avatar"
            src={user.picture}
            alt=""
            width={30}
            height={30}
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
          />
        ) : (
          <span className="auth-avatar auth-avatar-fallback" aria-hidden="true">
            {initial}
          </span>
        )}
      </button>

      {open && (
        <div className="auth-menu" role="menu">
          <div className="auth-menu-id">
            <div className="auth-menu-name">{user.name || "Signed in"}</div>
            <div className="auth-menu-email mono">{user.email}</div>
          </div>
          <div className="auth-menu-sep" />
          <button
            className="quiet auth-menu-out"
            role="menuitem"
            onClick={() => {
              signOut();
              setOpen(false);
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
