/**
 * App mode.
 *
 * OpenMLR runs in one of two modes, and the difference is *whose Valyu credits
 * pay for a review*:
 *
 *   self-hosted — the deployment's own VALYU_API_KEY pays for everything, and
 *                 nobody signs in. This is the mode you get by cloning the repo
 *                 and dropping a key in .env.local.
 *
 *   valyu       — every reviewer signs in with their own Valyu account over
 *                 OAuth, and their retrieval is billed to *their* credits via
 *                 the Valyu OAuth proxy. The deployment never needs an API key.
 *
 * The check is deliberately "anything that isn't valyu is self-hosted": an
 * unset or typo'd NEXT_PUBLIC_APP_MODE must fall back to the mode that works
 * without OAuth configuration, never to the one that locks everyone out.
 *
 * NEXT_PUBLIC_ so the same answer is available in the browser (to decide
 * whether to render sign-in at all) and on the server (to decide whether to
 * demand a token). Next.js inlines it at build time in client bundles, so this
 * must stay a static property access — destructuring `process.env` would break
 * the substitution.
 */
export function isSelfHostedMode(): boolean {
  return process.env.NEXT_PUBLIC_APP_MODE !== "valyu";
}

export function isValyuMode(): boolean {
  return process.env.NEXT_PUBLIC_APP_MODE === "valyu";
}
