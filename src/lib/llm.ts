import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";

/**
 * Thin wrapper around the OpenAI SDK for structured extraction/entailment.
 *
 * Trust invariant: the model only ever produces a verdict/structure — it never
 * fabricates a citation. Retrieval (Valyu) supplies the evidence; the model
 * reasons over it. See `verify.ts`.
 */

// Default to the fast reasoning tier. Structured extraction/entailment doesn't
// need deep reasoning, so we run at LOW effort by default — much faster, still
// accurate. Both are env-tunable; set OPENAI_REASONING_EFFORT=off to omit it.
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-terra";
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "low";
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

/**
 * Appended to every structured system prompt. Any `rationale`/explanation the
 * model writes lands verbatim in the reviewer's queue, so it must read like a
 * human reviewer's note, not a model narrating its evidence. Harmless on the
 * few passes (extraction, dossier) that emit no rationale.
 */
const RATIONALE_STYLE_NOTE =
  "\n\nIf you write any rationale or explanation field, make it read like a terse MLR reviewer's " +
  "note: one or two plain sentences that state the problem directly. Never open by narrating the " +
  "evidence — do not start with 'The excerpts…', 'The evidence…', 'The label…', 'The data…', or " +
  "'The provided/supplied/retrieved…'. Do not restate the claim, and avoid connectives like " +
  "'Thus', 'Therefore', 'As such', 'It is important to note'. Active voice; lead with the finding.";

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

/**
 * Run a single structured completion and validate it against a zod schema.
 * Returns the parsed, schema-conformant object or throws.
 */
export async function structured<T extends z.ZodTypeAny>(
  schema: T,
  opts: {
    name: string;
    system: string;
    user: string;
    /** Override reasoning effort for high-stakes judgment calls (default from env). */
    effort?: "minimal" | "low" | "medium" | "high";
  },
): Promise<z.infer<T>> {
  const effort = opts.effort ?? REASONING_EFFORT;
  const completion = await client().beta.chat.completions.parse({
    model: MODEL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(effort && effort !== "off" ? { reasoning_effort: effort as any } : {}),
    messages: [
      { role: "system", content: opts.system + RATIONALE_STYLE_NOTE },
      { role: "user", content: opts.user },
    ],
    response_format: zodResponseFormat(schema, opts.name),
  });

  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) {
    const refusal = completion.choices[0]?.message.refusal;
    throw new Error(refusal ? `model refused: ${refusal}` : "no parsed output from model");
  }
  return parsed;
}

/** Embed one or more texts (for semantic claims-library matching, F16 v2). */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await client().embeddings.create({ model: EMBED_MODEL, input: texts });
  return res.data.map((d) => d.embedding);
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
