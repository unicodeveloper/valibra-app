import { NextResponse } from "next/server";
import { withPersistenceScope, currentIdentity, ValyuAuthError } from "@/lib/valyu-credentials";

export const runtime = "nodejs";

/**
 * Resolves the caller's Valyu identity and returns nothing useful — the point is
 * the side effect.
 *
 * Identity comes from a userinfo round trip to the Valyu platform (~250ms),
 * cached server-side per access token. Without this, that cost lands on whatever
 * the reviewer clicks first — History or Library — and reads as a slow tab. The
 * client fires this once when a session starts (sign-in, rehydrate, refresh), so
 * the hop happens while nobody is waiting on it.
 *
 * Deliberately not a data endpoint: it exposes no history, no library, and only
 * whether the caller resolved to somebody. Everything scoped to the identity
 * keeps resolving it server-side, exactly as before.
 */
export async function GET(req: Request) {
  return withPersistenceScope(req, async () => {
    try {
      const identity = await currentIdentity();
      return NextResponse.json({ signedIn: Boolean(identity) });
    } catch (err) {
      if (err instanceof ValyuAuthError) {
        return NextResponse.json({ error: err.message, requiresReauth: true }, { status: 401 });
      }
      const message = err instanceof Error ? err.message : "Could not resolve session.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
