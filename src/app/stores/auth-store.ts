import { create } from "zustand";

/**
 * Auth session state.
 *
 * Tokens live in localStorage rather than a cookie because this app talks to
 * Valyu directly from its own API routes: the browser attaches the access token
 * as an Authorization header on each call, and the route forwards it to Valyu's
 * OAuth proxy. There is no server session to key a cookie against.
 *
 * The store is the single source of truth for "who is signed in", but every
 * read falls back to localStorage, because React state and localStorage can
 * legitimately disagree for a moment right after the OAuth redirect — see
 * getAccessToken().
 */

const TOKEN_STORAGE_KEY = "openmlr_valyu_tokens";
const USER_STORAGE_KEY = "openmlr_valyu_user";
/** Retired: DeepResearch tasks moved to owner-scoped server storage. Kept only
 *  so sign-out can clear it out of tabs that still carry the old cache. */
const LEGACY_DR_TASKS_KEY = "openmlr_dr_tasks";

/** Treat a token as expired 30s early, so it can't die mid-request. */
const EXPIRY_BUFFER_MS = 30_000;

/** Fallback lifetime when the auth server omits expires_in. */
const DEFAULT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface User {
  id: string;
  name: string;
  email: string;
  picture?: string;
  email_verified?: boolean;
}

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  initialized: boolean;
  showSignInModal: boolean;
  /** Optional conversion framing for the sign-in dialog — set when the modal is
   *  the free-trial wall rather than a plain sign-in. Null = default copy. */
  signInPrompt: { title: string; lede: string } | null;
  signIn: (
    user: User,
    tokens: { accessToken: string; refreshToken?: string; expiresIn?: number },
  ) => void;
  signOut: () => void;
  initialize: () => void;
  getAccessToken: () => string | null;
  refreshAccessToken: () => Promise<string | null>;
  openSignInModal: (prompt?: { title: string; lede: string }) => void;
  closeSignInModal: () => void;
}

/* ── localStorage helpers ────────────────────────────────────────────────── */
/* Every one of these is a no-op on the server and swallows parse/quota errors:
   a corrupted or unavailable store must degrade to "signed out", never throw
   during render. */

function saveTokens(tokens: TokenData): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    /* private mode / quota — session simply won't survive a reload */
  }
}

function loadTokens(): TokenData | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as TokenData) : null;
  } catch {
    return null;
  }
}

function saveUser(user: User): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } catch {
    /* see saveTokens */
  }
}

function loadUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(USER_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as User) : null;
  } catch {
    return null;
  }
}

function clearStored(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    // DeepResearch tasks are server-side and owner-scoped now, but a tab open
    // from before that change may still hold the old cache — full report bodies
    // and sources, readable by whoever signs in next. Purge it on the way out.
    sessionStorage.removeItem(LEGACY_DR_TASKS_KEY);
  } catch {
    /* nothing useful to do */
  }
}

function isTokenExpired(expiresAt: number): boolean {
  return Date.now() >= expiresAt - EXPIRY_BUFFER_MS;
}

/**
 * Resolve this token's identity on the server now, so the first History or
 * Library click doesn't pay the ~250ms Valyu userinfo round trip.
 *
 * Fire-and-forget by design: nothing renders off the result, so a failure here
 * must be invisible — the request that actually needs the identity will resolve
 * it (or surface the auth error) on its own. Keyed by token server-side, which
 * is why a refresh re-warms: a new access token is a new cache entry.
 */
function warmIdentity(accessToken: string | null | undefined): void {
  if (typeof window === "undefined" || !accessToken) return;
  void fetch("/api/session", { headers: { Authorization: `Bearer ${accessToken}` } }).catch(
    () => {},
  );
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  tokenExpiresAt: null,
  isAuthenticated: false,
  // Starts true so the UI can render a neutral "checking…" state rather than
  // flashing a Sign in button at someone who is already signed in.
  isLoading: true,
  initialized: false,
  showSignInModal: false,
  signInPrompt: null,

  /**
   * Rehydrate from localStorage. Called once from AuthInitializer, in an
   * effect — never during render, because localStorage doesn't exist on the
   * server and reading it during render would desync the hydrated markup.
   */
  initialize: () => {
    const state = get();

    // Already signed in this page-life (e.g. we navigated here from the OAuth
    // callback, which called signIn directly). Nothing to rehydrate.
    if (state.isAuthenticated && state.accessToken) {
      set({ initialized: true, isLoading: false });
      return;
    }
    if (state.initialized) {
      set({ isLoading: false });
      return;
    }

    const user = loadUser();
    const tokens = loadTokens();

    if (user && tokens) {
      const expired = isTokenExpired(tokens.expiresAt);

      // An expired access token is only fatal if we also have no way to renew
      // it. With a refresh token we keep the session up and renew in the
      // background, so a returning reviewer never sees a sign-in prompt they
      // didn't need.
      if (!expired || tokens.refreshToken) {
        set({
          user,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? null,
          tokenExpiresAt: tokens.expiresAt,
          isAuthenticated: true,
          isLoading: false,
          initialized: true,
        });
        // An expired token is about to be swapped for a new one, and the new one
        // is what needs warming — refreshAccessToken does that itself.
        if (expired) void get().refreshAccessToken();
        else warmIdentity(tokens.accessToken);
        return;
      }
    }

    clearStored();
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      isAuthenticated: false,
      isLoading: false,
      initialized: true,
    });
  },

  signIn: (user, tokens) => {
    const expiresAt = tokens.expiresIn
      ? Date.now() + tokens.expiresIn * 1000
      : Date.now() + DEFAULT_TOKEN_TTL_MS;

    saveUser(user);
    saveTokens({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt,
    });

    set({
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
      tokenExpiresAt: expiresAt,
      isAuthenticated: true,
      isLoading: false,
      initialized: true,
    });

    warmIdentity(tokens.accessToken);
  },

  signOut: () => {
    clearStored();
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      isAuthenticated: false,
      isLoading: false,
      showSignInModal: false,
    });
  },

  /** A currently-valid access token, or null. Never returns an expired one. */
  getAccessToken: () => {
    const state = get();

    if (state.accessToken) {
      if (state.tokenExpiresAt && isTokenExpired(state.tokenExpiresAt)) return null;
      return state.accessToken;
    }

    // Fallback for the window right after the OAuth redirect, where
    // localStorage has been written but this store instance hasn't caught up
    // yet. Adopt what we find so subsequent reads hit the fast path.
    const tokens = loadTokens();
    const user = loadUser();
    if (tokens?.accessToken && user && !isTokenExpired(tokens.expiresAt)) {
      set({
        user,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? null,
        tokenExpiresAt: tokens.expiresAt,
        isAuthenticated: true,
        isLoading: false,
        initialized: true,
      });
      return tokens.accessToken;
    }

    return null;
  },

  /**
   * Renew the access token. Returns null if the session is unrecoverable, in
   * which case we sign out — leaving a dead session on screen would let the
   * reviewer keep starting reviews that can only fail.
   */
  refreshAccessToken: async () => {
    const refreshToken = get().refreshToken ?? loadTokens()?.refreshToken;
    if (!refreshToken) {
      get().signOut();
      return null;
    }

    try {
      const response = await fetch("/api/oauth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        get().signOut();
        return null;
      }

      const { access_token, refresh_token, expires_in } = await response.json();
      const expiresAt = Date.now() + (expires_in || 3600) * 1000;
      // The auth server may or may not rotate the refresh token; keep the old
      // one when it doesn't, or we'd lose the ability to refresh again.
      const nextRefresh = refresh_token || refreshToken;

      saveTokens({ accessToken: access_token, refreshToken: nextRefresh, expiresAt });
      set({
        accessToken: access_token,
        refreshToken: nextRefresh,
        tokenExpiresAt: expiresAt,
        isAuthenticated: true,
      });

      // New token, new server-side cache key — the old warm entry is dead.
      warmIdentity(access_token);

      return access_token;
    } catch (error) {
      // A network blip is not proof the session is dead, so unlike the !ok
      // branch above we leave the session intact and let the caller retry.
      console.error("Token refresh error:", error);
      return null;
    }
  },

  openSignInModal: (prompt) => set({ showSignInModal: true, signInPrompt: prompt ?? null }),
  closeSignInModal: () => set({ showSignInModal: false, signInPrompt: null }),
}));

/**
 * Fetch helper for anything that spends Valyu credits.
 *
 * Centralised so no call site can forget the Authorization header — a missing
 * header in `valyu` mode is not a visible bug, it's a request that quietly
 * fails auth. Refreshes a stale token first, so a long-idle tab recovers
 * instead of bouncing the reviewer to sign-in.
 *
 * In self-hosted mode there is no token and none is attached; the server pays
 * with its own key.
 */
export async function authorizedHeaders(
  base: Record<string, string> = {},
): Promise<Record<string, string>> {
  const { getAccessToken, refreshAccessToken } = useAuthStore.getState();

  // getAccessToken() reads the store, then falls back to localStorage and adopts
  // a still-valid persisted session. That fallback is what makes a page RELOAD
  // work: this runs before the auth store has rehydrated, and the old
  // `if (!isAuthenticated) return base` guard raced that rehydration — it sent no
  // token, drew a 401, and (via handleAuthFailure → signOut) wiped the session,
  // so every reload of e.g. /review/[id] demanded a fresh sign-in.
  let token = getAccessToken();

  // Token missing or expired but a persisted session exists → refresh it.
  // Guarded on a stored refresh token so self-hosted (no session) attaches
  // nothing and never triggers a needless sign-out.
  if (!token && loadTokens()?.refreshToken) token = await refreshAccessToken();

  return token ? { ...base, Authorization: `Bearer ${token}` } : base;
}

/**
 * Handle a 401 from an API route by reopening the sign-in modal.
 * Returns true if the response was an auth failure the caller should stop on.
 */
export function handleAuthFailure(status: number, body: { requiresReauth?: boolean }): boolean {
  if (status !== 401 && !body?.requiresReauth) return false;
  const { signOut, openSignInModal } = useAuthStore.getState();
  signOut();
  openSignInModal();
  return true;
}
