/**
 * A stable per-browser id for the free-trial meter. Not identity and not a
 * session — just a client fingerprint so the server can cap anonymous reviews
 * per visitor (the honest-user limit; IP + daily budget are the abuse
 * backstops). Cleared storage resets it, which the IP cap is there to catch.
 */
const KEY = "openmlr_anon_id";

export function anonId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, "");
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return ""; // private mode / storage blocked — server falls back to IP + budget
  }
}
