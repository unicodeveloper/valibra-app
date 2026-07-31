import { NextResponse } from "next/server";
import { z } from "zod";
import { structured } from "@/lib/llm";
import { logServerError, publicErrorMessage } from "@/lib/api-errors";
import { bearerToken } from "@/lib/valyu-credentials";
import { isSelfHostedMode } from "@/lib/app-mode";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Draft a grounded suggested revision for a flagged claim, so a "request
 * revision"/"reject" becomes an actionable fix for the content team.
 *
 * This is retrieval-grounded and advisory, matching the rest of the tool: the
 * model may only use the evidence the pipeline already retrieved, must never
 * fabricate facts or citations, and abstains when there's nothing to ground a
 * fix. It's OpenAI-only (server key), so it spends no Valyu credits and needs
 * no billing scope.
 */

const EvidenceSchema = z.object({
  title: z.string().optional().default(""),
  url: z.string().optional().default(""),
  snippet: z.string().optional().default(""),
});

const RequestSchema = z.object({
  claimText: z.string().min(1, "claimText is required"),
  category: z.string().default(""),
  headline: z.string().default(""), // the verdict headline, e.g. "Not supported by the evidence"
  detail: z.string().default(""), // the pipeline's rationale for the finding
  evidence: z.array(EvidenceSchema).default([]),
});

const SuggestionSchema = z.object({
  kind: z
    .enum(["rewrite", "instruction", "abstain"])
    .describe(
      "rewrite = a compliant replacement for the claim, grounded in the evidence; " +
        "instruction = a concrete change when a verbatim rewrite isn't right (add a " +
        "warning, remove the claim, add a citation, limit to the approved indication); " +
        "abstain = there is no grounded fix to offer.",
    ),
  text: z
    .string()
    .describe(
      "For rewrite: the proposed replacement copy only, no preamble or quotes. " +
        "For instruction: a single actionable sentence. " +
        "For abstain: a short reason there is no grounded suggestion.",
    ),
});

const SYSTEM =
  "You help a Medical-Legal-Regulatory (MLR) reviewer turn a flagged promotional claim into an " +
  "actionable fix for the content team. You are grounded and conservative, with the same discipline as " +
  "the rest of this tool:\n" +
  "- NEVER invent evidence, citations, statistics, or clinical facts. Use ONLY the provided evidence.\n" +
  "- If the evidence supports a narrower, compliant version of the claim, return kind='rewrite' with " +
  "that wording, and nothing the evidence does not support.\n" +
  "- If the right fix is structural rather than a reword (add an omitted safety/risk statement, limit " +
  "an off-label claim to the approved indication, add a citation, or remove an unsupported claim), " +
  "return kind='instruction' with one concrete sentence.\n" +
  "- If there is NO supporting evidence, do NOT rewrite the claim into something that sounds supported. " +
  "Return kind='instruction' to remove it or add a citation, or kind='abstain' if you cannot ground " +
  "any fix.\n" +
  "- Keep it short, specific, and implementable. No hedging, no meta-commentary.";

export async function POST(req: Request) {
  // Gate like the other model-spending routes: OpenAI is server-paid in both
  // modes, so in valyu mode a request must be signed in — an open endpoint would
  // let anyone burn the deployment's OpenAI budget. (Presence check, matching
  // the billing gate; self-hosted has no auth and runs on its own key.)
  if (!isSelfHostedMode() && !bearerToken(req)) {
    return NextResponse.json(
      { error: "Sign in to draft a suggestion.", requiresReauth: true },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const f = parsed.data;
  const evidenceText = f.evidence.length
    ? f.evidence
        .map((e, i) => `[${i + 1}] ${e.title}${e.snippet ? `: ${e.snippet.slice(0, 600)}` : ""}`)
        .join("\n")
    : "(no supporting evidence was retrieved for this claim)";

  const user =
    `MLR finding category: ${f.category || "(unspecified)"}\n` +
    `Verdict: ${f.headline || "(unspecified)"}\n` +
    `Why it was flagged: ${f.detail || "(none)"}\n\n` +
    `Claim as written:\n"""${f.claimText}"""\n\n` +
    `Evidence available:\n${evidenceText}`;

  try {
    const suggestion = await structured(SuggestionSchema, {
      name: "revision_suggestion",
      system: SYSTEM,
      user,
      effort: "low",
    });
    return NextResponse.json(suggestion);
  } catch (err) {
    const message = publicErrorMessage(err, "Could not draft a suggestion. Check the server logs.");
    logServerError("suggestRevision failed", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
