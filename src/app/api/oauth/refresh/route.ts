import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Refresh-token exchange.
 *
 * Access tokens are short-lived; a review can take minutes, and a reviewer who
 * left a tab open overnight should not be thrown back to a sign-in screen. The
 * auth store calls this to trade a refresh token for a fresh access token.
 *
 * Server-side for the same reason as the token route: it needs the client
 * secret.
 */
export async function POST(request: Request) {
  try {
    const { refreshToken } = await request.json();

    if (!refreshToken) {
      return NextResponse.json({ error: "Missing refresh token." }, { status: 400 });
    }

    const clientId = process.env.NEXT_PUBLIC_VALYU_CLIENT_ID;
    const clientSecret = process.env.VALYU_CLIENT_SECRET;
    const authUrl = process.env.NEXT_PUBLIC_VALYU_AUTH_URL;

    if (!clientId || !clientSecret || !authUrl) {
      return NextResponse.json(
        { error: "OAuth is not fully configured on the server." },
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
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!tokenResponse.ok) {
      console.error("Token refresh failed:", await tokenResponse.text());
      return NextResponse.json({ error: "Token refresh failed." }, { status: tokenResponse.status });
    }

    const tokenData = await tokenResponse.json();

    return NextResponse.json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
    });
  } catch (error) {
    console.error("Token refresh error:", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
