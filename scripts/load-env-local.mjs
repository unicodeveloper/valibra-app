/**
 * Load .env.local into process.env, if it's there.
 *
 * Deliberately not `node --env-file-if-exists=...`: that flag only exists from
 * Node 20.12, package.json allows any Node >= 20, and db:init runs as Railway's
 * preDeployCommand — on an older runtime the unknown flag would fail the command
 * and take the deploy with it. A dozen lines of parsing is cheaper than that
 * class of outage.
 *
 * Existing environment variables always win, matching how Next.js loads env
 * files: on Railway the real config is already in the environment, and a
 * checked-out .env.local must never override it.
 */
import { readFileSync } from "node:fs";

export function loadEnvLocal(path = ".env.local") {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // absent is the normal case in a deployed environment
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!key || key in process.env) continue;

    let value = trimmed.slice(eq + 1).trim();
    // Strip one matching pair of surrounding quotes, the way dotenv does.
    if (value.length > 1 && (value.startsWith('"') || value.startsWith("'"))) {
      const quote = value[0];
      if (value.endsWith(quote)) value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
