/**
 * OAuth 2.0 Authorization Code flow with PKCE, against Valyu's auth server.
 *
 * PKCE (RFC 7636) rather than a plain code exchange because the initiating half
 * of this flow runs in the browser, where no client secret can be kept. The
 * verifier never leaves the origin; only its SHA-256 hash travels in the
 * authorize URL, so an intercepted authorization code is useless without the
 * verifier held in this tab's localStorage.
 *
 * The secret half of the exchange (client_secret_basic) happens server-side in
 * /api/oauth/token — see that route.
 */

/** Cryptographically random PKCE code verifier (43-char base64url of 32 bytes). */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64URLEncode(array);
}

/** S256 code challenge — the SHA-256 of the verifier, base64url-encoded. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64URLEncode(new Uint8Array(hash));
}

/** base64url: standard base64 with the URL-unsafe chars swapped and padding dropped. */
function base64URLEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** localStorage keys for the in-flight authorization request. */
export const OAUTH_KEYS = {
  verifier: "valibra_oauth_code_verifier",
  state: "valibra_oauth_state",
  timestamp: "valibra_oauth_timestamp",
} as const;

/** Drop every trace of an in-flight authorization request. */
export function clearOAuthData(): void {
  if (typeof window === "undefined") return;
  for (const key of Object.values(OAUTH_KEYS)) localStorage.removeItem(key);
}

/**
 * Whether this deployment has the public half of the OAuth config.
 *
 * Only the NEXT_PUBLIC_ values are checked, because those are the only ones the
 * browser can see — VALYU_CLIENT_SECRET is server-only by design and is
 * validated in the token route instead.
 */
export function isOAuthConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_VALYU_CLIENT_ID &&
    process.env.NEXT_PUBLIC_VALYU_AUTH_URL &&
    process.env.NEXT_PUBLIC_REDIRECT_URI
  );
}

/** Redirect to Valyu's authorize endpoint, starting the PKCE flow. */
export async function initiateOAuthFlow(): Promise<void> {
  if (!isOAuthConfigured()) {
    throw new Error(
      "OAuth is not configured. Set NEXT_PUBLIC_VALYU_CLIENT_ID, " +
        "NEXT_PUBLIC_VALYU_AUTH_URL and NEXT_PUBLIC_REDIRECT_URI.",
    );
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // `state` is a second, independent random value — CSRF protection. The
  // callback refuses to exchange a code whose state doesn't match what we
  // stored, so an attacker can't feed us an authorization code of their own.
  const state = generateCodeVerifier();

  // localStorage rather than sessionStorage: the authorize redirect can come
  // back in a different tab (or after a browser restart on mobile), and
  // sessionStorage would be gone by then. The timestamp bounds how long that
  // window stays open — see OAUTH_EXPIRY_MS in the callback.
  localStorage.setItem(OAUTH_KEYS.verifier, codeVerifier);
  localStorage.setItem(OAUTH_KEYS.state, state);
  localStorage.setItem(OAUTH_KEYS.timestamp, Date.now().toString());

  const authUrl = new URL("/auth/v1/oauth/authorize", process.env.NEXT_PUBLIC_VALYU_AUTH_URL);
  authUrl.searchParams.set("client_id", process.env.NEXT_PUBLIC_VALYU_CLIENT_ID!);
  authUrl.searchParams.set("redirect_uri", process.env.NEXT_PUBLIC_REDIRECT_URI!);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid profile email");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  window.location.href = authUrl.toString();
}

/** OIDC userinfo claims returned by the Valyu platform. */
export interface UserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  updated_at?: string;
}
