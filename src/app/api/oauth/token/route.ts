import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * PKCE token exchange.
 *
 * This half runs on the server because it authenticates with
 * client_secret_basic — VALYU_CLIENT_SECRET must never reach the browser. The
 * browser holds only the code verifier, which it posts here alongside the
 * authorization code; we combine the two with the secret and hand back tokens.
 *
 * We also resolve the user's profile here rather than making the client do a
 * second round trip, so the callback page can complete sign-in in one request.
 */
export async function POST(request: Request) {
  try {
    const { code, codeVerifier } = await request.json();

    if (!code || !codeVerifier) {
      return NextResponse.json({ error: "Missing code or codeVerifier." }, { status: 400 });
    }

    const clientId = process.env.NEXT_PUBLIC_VALYU_CLIENT_ID;
    const clientSecret = process.env.VALYU_CLIENT_SECRET;
    const authUrl = process.env.NEXT_PUBLIC_VALYU_AUTH_URL;
    const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;

    // Checked explicitly so a half-configured deployment says which variable is
    // missing, instead of failing as an opaque 401 from the auth server.
    if (!clientId || !clientSecret || !authUrl || !redirectUri) {
      return NextResponse.json(
        {
          error:
            "OAuth is not fully configured on the server. Required: NEXT_PUBLIC_VALYU_CLIENT_ID, " +
            "VALYU_CLIENT_SECRET, NEXT_PUBLIC_VALYU_AUTH_URL, NEXT_PUBLIC_REDIRECT_URI.",
        },
        { status: 500 },
      );
    }

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const tokenResponse = await fetch(`${authUrl}/auth/v1/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const details = await tokenResponse.text();
      console.error("Token exchange failed:", details);
      return NextResponse.json(
        { error: "Token exchange failed." },
        { status: tokenResponse.status },
      );
    }

    const { access_token, refresh_token, expires_in } = await tokenResponse.json();

    const appUrl = process.env.VALYU_APP_URL || "https://platform.valyu.ai";
    const userInfoResponse = await fetch(`${appUrl}/api/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userInfoResponse.ok) {
      console.error("Failed to fetch user info:", await userInfoResponse.text());
      return NextResponse.json(
        { error: "Signed in, but could not load your Valyu profile." },
        { status: userInfoResponse.status },
      );
    }

    const userInfo = await userInfoResponse.json();

    return NextResponse.json({
      access_token,
      refresh_token,
      expires_in,
      user: {
        id: userInfo.sub,
        email: userInfo.email,
        // Falls back to the email so the UI always has something to render —
        // `name` is an optional OIDC claim and Valyu accounts often lack it.
        name: userInfo.name || userInfo.email,
        picture: userInfo.picture,
        email_verified: userInfo.email_verified,
      },
    });
  } catch (error) {
    console.error("Token exchange error:", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
