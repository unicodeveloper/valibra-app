import { structured } from "../llm";
import { ExtractionSchema, type Extraction } from "../schemas";

/**
 * F1 — Claim extraction & typing.
 * Pull every discrete claim from the asset and classify it, plus identify the
 * promoted drug/product so downstream steps can fetch its label.
 */
export function extractClaims(assetText: string): Promise<Extraction> {
  return structured(ExtractionSchema, {
    name: "extraction",
    /**
     * The one call that must not wobble. Everything downstream is keyed to the
     * claim set, so an unstable decomposition makes every metric unstable with
     * it — the same ISI came back as 8, 9, 13, 18 and 19 claims across runs at
     * the default `low`. Reasoning models don't expose temperature or seed at
     * any effort above `none`, so effort is the only lever, and this is one call
     * per review: the cheapest possible place to spend it.
     */
    effort: "high",
    system:
      "You are an MLR (Medical-Legal-Regulatory) reviewer's assistant for pharmaceutical " +
      "promotional content. Extract every discrete, standalone claim a regulator would " +
      "scrutinize. Quote each claim verbatim. Classify each by type — including 'epidemiology' " +
      "(prevalence/burden, e.g. 'leading cause of death'), 'biomarker' (precision-medicine, e.g. " +
      "'for patients with the EGFR mutation'), and 'surveillance' (trend claims, e.g. 'cases are " +
      "rising'). Tie-breaker: if a claim selects patients by a specific biomarker, genetic mutation, " +
      "or companion diagnostic, classify it as 'biomarker' — even when it is phrased as an indication " +
      "('indicated for patients whose tumors carry the EGFR mutation' is 'biomarker', not " +
      "'indication'). Do NOT extract a headline/banner that merely names the product or a bare tagline " +
      "(e.g. 'DRUGNAME (ingredient) — proven control') as a claim; extract the substantive " +
      "assertions (usually the body/bullets) and quote each as the assertion itself, without the " +
      "product-name prefix or banner formatting. For each claim, also write a " +
      "concise literature-search query (searchQuery): the drug's generic/active-ingredient name " +
      "plus the scientific concepts, stripped of brand names and marketing puffery. The query is " +
      "matched against indexed literature, so it must not carry the asset's own timepoints, " +
      "figures, or trial-specific population labels — those appear in no document and the search " +
      "returns nothing at all. Keep the substantive outcome words. Also identify " +
      "the primary drug/product being promoted (drugName) as a CLEAN generic/active-ingredient " +
      "name only — lowercase, no brand styling, no parentheticals, no dosage form, no headline " +
      "text (e.g. 'metformin', not 'METFORMIN (metformin hydrochloride) — proven control'). Do not " +
      "invent claims that are not present. Do not merge distinct claims. If no drug is named, " +
      "return an empty drugName.\n" +
      // A coordinated list ("pancreatitis, vision changes, hypoglycemia, kidney problems…")
      // is one assertion read one way and six read another, and the prompt used to leave the
      // choice open — which is what made the same ISI come back as 8 claims one run and 17 the
      // next. Worse, once the model started splitting it emitted cumulative prefixes of the
      // same sentence ("…may include nausea", "…may include nausea, vomiting", …), so the
      // same text was verified several times over as if it were several claims.
      "Granularity rules, applied strictly:\n" +
      "- A single sentence listing several items in one coordinated series (e.g. 'may cause " +
      "A, B, C and D') is ONE claim. Quote the whole sentence. Do NOT emit one claim per item.\n" +
      "- Never emit a claim whose text is a substring, prefix, or truncation of another claim. " +
      "Every claim must be a complete, standalone assertion that stands on its own.\n" +
      "- Quote each claim as a whole grammatical statement including its subject — 'Ozempic may " +
      "cause X', not the bare fragment 'may cause X' or 'X'.",
    user: `Extract the claims and drug from this promotional asset:\n\n"""\n${assetText}\n"""`,
  });
}
