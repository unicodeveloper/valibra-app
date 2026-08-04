import { AsyncLocalStorage } from "node:async_hooks";
import { Valyu } from "valyu-js";
import { isSelfHostedMode } from "./app-mode";

/**
 * Who pays for retrieval.
 *
 * A single review fans out across ~15 Valyu calls made from a dozen pipeline
 * modules (extract, verify, fairbalance, offlabel, …), none of which have any
 * business knowing about HTTP requests or OAuth. In `valyu` mode each of those
 * calls has to be billed to the *signed-in reviewer's* credits, which means the
 * caller's access token has to reach the bottom of that call tree.
 *
 * Threading an `accessToken` parameter through every function in the pipeline
 * would have touched every signature in src/lib/pipeline for something that is
 * ambient request context, not a domain input — and every new retrieval helper
 * would then be one forgotten parameter away from silently billing the app's
 * own key instead of the user's.
 *
 * So the credential rides in AsyncLocalStorage instead. The API route opens a
 * scope for the request, and the transport below reads it. Node's ALS keeps the
 * value bound across every `await` in the fan-out, and concurrent requests each
 * get their own store — so two reviewers running reviews at the same time can
 * never see each other's token.
 *
 * This is Node-only (`node:async_hooks`), which is fine and enforced: every
 * route that runs the pipeline already declares `export const runtime = "nodejs"`.
 */

export interface ValyuCredential {
  /** OAuth access token — bill this user's credits via the platform proxy. */
  accessToken: string;
}

const store = new AsyncLocalStorage<ValyuCredential>();

/** Run `fn` with the reviewer's OAuth credential bound for all retrieval inside it. */
export function withValyuCredential<T>(credential: ValyuCredential, fn: () => T): T {
  return store.run(credential, fn);
}

/** The Bearer access token on a request, if the client attached one. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/**
 * Run `fn` with `token` bound as the billing credential, or with no credential
 * when `token` is null (self-hosted).
 *
 * The explicit-token form matters for the streaming review route: its work runs
 * inside a ReadableStream `start` callback that fires *after* the route handler
 * has returned, by which point an ambient ALS scope has already unwound. Passing
 * the captured token back into a fresh scope there re-binds it for the fan-out.
 */
export function runScoped<T>(token: string | null, fn: () => T): T {
  return token ? withValyuCredential({ accessToken: token }, fn) : fn();
}

/**
 * Run a route handler with Valyu billing set up for this request.
 *
 * One wrapper so every credit-consuming route gates the same way, and no route
 * can forget the check:
 *   1. bind the caller's token (if any) so all retrieval underneath bills them;
 *   2. refuse early — before any Valyu spend — if this request has no way to
 *      pay (valyu mode with no token, or self-hosted with no key), returning the
 *      401/500 the client's reauth handling expects.
 * On the 401 we add `requiresReauth` so the browser knows to reopen sign-in
 * rather than just surfacing an error.
 */
export async function withValyuBilling(
  req: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  const token = bearerToken(req);
  return runScoped(token, () => {
    const ready = retrievalReadiness();
    if (!ready.ok) {
      return Promise.resolve(
        Response.json(
          ready.status === 401 ? { error: ready.error, requiresReauth: true } : { error: ready.error },
          { status: ready.status },
        ),
      );
    }
    return handler();
  });
}

/** The credential in scope, if the caller signed in. */
export function currentCredential(): ValyuCredential | undefined {
  return store.getStore();
}

/**
 * Resolve how the current request should reach Valyu, or explain why it can't.
 *
 * Called at the top of a route so a misconfiguration surfaces as one clear
 * error before any work starts, rather than as fifteen identical failures
 * halfway through a fan-out.
 */
export function retrievalReadiness(): { ok: true } | { ok: false; status: number; error: string } {
  if (currentCredential()) return { ok: true };

  if (!isSelfHostedMode()) {
    return {
      ok: false,
      status: 401,
      error: "Sign in to run a review — it runs on your own Valyu credits.",
    };
  }

  if (!process.env.VALYU_API_KEY) {
    return {
      ok: false,
      status: 500,
      error:
        "VALYU_API_KEY is not set. Set it for self-hosted mode, or set " +
        "NEXT_PUBLIC_APP_MODE=valyu to have reviewers sign in with their own Valyu account.",
    };
  }

  return { ok: true };
}

/* ── Transport ───────────────────────────────────────────────────────────── */

const VALYU_APP_URL = process.env.VALYU_APP_URL || "https://platform.valyu.ai";

let _client: Valyu | null = null;

/** The app-key SDK client, for self-hosted mode. Lazy so an unset key fails at use, not import. */
function appClient(): Valyu {
  if (!_client) {
    const apiKey = process.env.VALYU_API_KEY;
    if (!apiKey) throw new Error("VALYU_API_KEY is not set");
    _client = new Valyu(apiKey);
  }
  return _client;
}

/**
 * Call the Valyu REST API as the signed-in user, through the platform's OAuth
 * proxy. The proxy takes the API path we want and forwards it upstream under
 * the user's account, so the deduction lands on their credits.
 *
 * Paths here mirror exactly what valyu-js hits with an API key (`/v1/search`,
 * `/v1/deepresearch/tasks`, …), so the two lanes stay behaviourally identical.
 */
async function viaProxy(
  accessToken: string,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<any> {
  const response = await fetch(`${VALYU_APP_URL}/api/oauth/proxy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path, method, body }),
  });

  if (!response.ok) {
    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
    const detail = data?.message || data?.error || text || `HTTP ${response.status}`;

    // 401/403 mean the token died mid-flight. Phrased so the message matches
    // what the auth store's reauth detection looks for, and so the reviewer is
    // told to sign in again rather than shown a raw status code.
    if (response.status === 401 || response.status === 403) {
      throw new ValyuAuthError("Session expired. Please sign in again.");
    }
    // 402 is the user being out of credits, which is a distinct, actionable
    // state — src/lib/valyu.ts latches its circuit breaker on this wording.
    if (response.status === 402) {
      throw new Error("Insufficient credits. Please top up your Valyu account.");
    }
    throw new Error(detail);
  }

  return response.json();
}

/** Signals a dead/expired OAuth token, so routes can answer 401 + requiresReauth. */
export class ValyuAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValyuAuthError";
  }
}

/* ── Identity ────────────────────────────────────────────────────────────────
 *
 * Who is signed in, for scoping *persistence* (review history, claims library,
 * decisions) to one Valyu account. This is a different question from billing:
 * the access token says who *pays* for a search; the identity says whose stored
 * *data* a request may see. In valyu mode two reviewers sign in with their own
 * accounts, so their history and library must not bleed across each other.
 *
 * Identity is always derived server-side from the token — never trusted from
 * the client — so a caller can't read another account's data by claiming its
 * `sub`. In self-hosted mode there is no token and no user: identity is null and
 * persistence stays global (the single tenant that owns the deployment).
 */

export interface ValyuIdentity {
  /** OIDC subject — the stable per-account id we scope stored data by. */
  sub: string;
  /** Email, for attributing decisions in the audit trail. May be empty. */
  email: string;
}

/**
 * userinfo is a network round trip, and a reviewer opening the History tab
 * shouldn't pay it per row. Cache by token for a short window — long enough to
 * amortize a burst of persistence calls, short enough that a revoked token
 * stops resolving quickly. Keyed by the opaque token, so a new token (refresh,
 * different user) never reads a stale entry.
 */
const IDENTITY_TTL_MS = 60_000;
const identityCache = new Map<string, { identity: ValyuIdentity; expires: number }>();
const identityInFlight = new Map<string, Promise<ValyuIdentity>>();

async function resolveIdentity(accessToken: string): Promise<ValyuIdentity> {
  const cached = identityCache.get(accessToken);
  if (cached && cached.expires > Date.now()) return cached.identity;

  const pending = identityInFlight.get(accessToken);
  if (pending) return pending;

  const request = (async () => {
    const res = await fetch(`${VALYU_APP_URL}/api/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // A dead token here is the same reauth signal the proxy raises mid-flight.
    if (res.status === 401 || res.status === 403) {
      identityCache.delete(accessToken);
      throw new ValyuAuthError("Session expired. Please sign in again.");
    }
    if (!res.ok) throw new Error(`Could not resolve Valyu identity (HTTP ${res.status}).`);

    const info = await res.json();
    if (!info?.sub) throw new Error("Valyu userinfo did not return a subject.");

    const identity: ValyuIdentity = { sub: String(info.sub), email: info.email ? String(info.email) : "" };
    identityCache.set(accessToken, { identity, expires: Date.now() + IDENTITY_TTL_MS });
    return identity;
  })();

  identityInFlight.set(accessToken, request);
  try {
    return await request;
  } finally {
    identityInFlight.delete(accessToken);
  }
}

/**
 * The signed-in reviewer's identity, or null in self-hosted mode.
 *
 * Reads the ambient credential, so call it inside a scope opened by
 * withPersistenceScope / withValyuBilling / runScoped — the same scopes that
 * bind the billing token. Captures the credential synchronously before awaiting,
 * so the ALS context is read while still bound.
 */
export async function currentIdentity(): Promise<ValyuIdentity | null> {
  const credential = currentCredential();
  if (!credential) return null;
  return resolveIdentity(credential.accessToken);
}

/**
 * Run a persistence route with the caller's identity resolvable.
 *
 * Sibling of withValyuBilling, for routes that read/write stored data rather
 * than spend credits: it binds the token so currentIdentity() works, and in
 * valyu mode refuses a request with no token — persistence there is per-user,
 * so an anonymous caller has nothing to see and must sign in. Self-hosted has
 * no users, so it proceeds unbound and every owner check resolves to the single
 * global tenant.
 */
export async function withPersistenceScope(
  req: Request,
  handler: () => Promise<Response>,
  /** What the caller is guarding, for the sign-in message. Persisted data is
   *  owner-scoped, so more than one kind of thing sits behind this gate and
   *  "see your reviews" is wrong for most of them. */
  subject = "your saved work",
): Promise<Response> {
  const token = bearerToken(req);
  if (!token && !isSelfHostedMode()) {
    return Response.json(
      { error: `Sign in to see ${subject}.`, requiresReauth: true },
      { status: 401 },
    );
  }
  return runScoped(token, handler);
}

/**
 * Options we actually pass to Valyu search, in the SDK's camelCase spelling.
 * Kept to the subset src/lib/valyu.ts uses — anything unused here would be a
 * shape we've never exercised over the proxy.
 */
export interface SearchOptions {
  includedSources?: string[];
  maxNumResults?: number;
  searchType?: "all" | "web" | "proprietary";
  instructions?: string;
  sourceBiases?: Record<string, number>;
}

/**
 * One search, billed to whoever is in scope.
 *
 * Both lanes return the SDK's response shape (`{ success, results, ... }`), so
 * callers upstream cannot tell which lane served them — which is the point.
 * The proxy lane hand-builds the snake_case wire payload that valyu-js would
 * have built from these same options.
 */
export async function valyuSearch(query: string, options: SearchOptions = {}): Promise<any> {
  const credential = currentCredential();

  if (!credential) {
    return appClient().search(query, options);
  }

  const payload: Record<string, unknown> = { query };
  if (options.searchType !== undefined) payload.search_type = options.searchType;
  if (options.maxNumResults !== undefined) payload.max_num_results = options.maxNumResults;
  if (options.includedSources !== undefined) payload.included_sources = options.includedSources;
  if (options.sourceBiases !== undefined) payload.source_biases = options.sourceBiases;
  if (options.instructions !== undefined) payload.instructions = options.instructions;

  try {
    return await viaProxy(credential.accessToken, "/v1/search", "POST", payload);
  } catch (err) {
    // Mirror the SDK's failure convention rather than throwing: valyu.ts reads
    // `success === false` to distinguish "we searched and found nothing" from
    // "we couldn't search", and to latch its credit circuit breaker. Throwing
    // here would collapse that distinction into a 500.
    const error = err instanceof Error ? err.message : "Valyu search failed.";
    return { success: false, error, results: [] };
  }
}

/** DeepResearch create options, in the SDK's camelCase spelling. */
export interface DeepResearchCreateOptions {
  query: string;
  mode?: string;
  search?: { searchType?: "all" | "web" | "proprietary" };
  /** Valyu emails this address when the task finishes. */
  alertEmail?: string;
  /** Ask Valyu to render the report as well as return markdown. Without "pdf"
   *  here the finished task carries no pdf_url — it defaults to markdown only. */
  outputFormats?: string[];
}

/**
 * Create a DeepResearch task, billed to whoever is in scope.
 *
 * The API-key lane hands the camelCase options straight to valyu-js. The proxy
 * lane talks to the REST endpoint directly, so it has to do the same
 * camelCase→snake_case rewrite the SDK does internally — `searchType` on the
 * wire is `search_type`, and sending the camelCase key would have silently
 * dropped the search configuration rather than erroring.
 */
export async function valyuDeepResearchCreate(
  options: DeepResearchCreateOptions,
): Promise<any> {
  const credential = currentCredential();
  if (!credential) return appClient().deepresearch.create(options as any);

  const payload: Record<string, unknown> = { query: options.query };
  if (options.mode !== undefined) payload.mode = options.mode;
  if (options.search?.searchType !== undefined) {
    payload.search = { search_type: options.search.searchType };
  }
  // Same camelCase→snake_case rewrite the SDK does internally.
  if (options.alertEmail !== undefined) payload.alert_email = options.alertEmail;
  if (options.outputFormats !== undefined) payload.output_formats = options.outputFormats;

  return viaProxy(credential.accessToken, "/v1/deepresearch/tasks", "POST", payload);
}

/** Poll a DeepResearch task, billed to whoever is in scope. */
export async function valyuDeepResearchStatus(taskId: string): Promise<any> {
  const credential = currentCredential();
  if (!credential) return appClient().deepresearch.status(taskId);
  return viaProxy(
    credential.accessToken,
    `/v1/deepresearch/tasks/${encodeURIComponent(taskId)}/status`,
    "GET",
  );
}
