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
      "plus the scientific concepts, stripped of brand names and marketing puffery. Also identify " +
      "the primary drug/product being promoted (drugName) as a CLEAN generic/active-ingredient " +
      "name only — lowercase, no brand styling, no parentheticals, no dosage form, no headline " +
      "text (e.g. 'metformin', not 'METFORMIN (metformin hydrochloride) — proven control'). Do not " +
      "invent claims that are not present. Do not merge distinct claims. If no drug is named, " +
      "return an empty drugName.",
    user: `Extract the claims and drug from this promotional asset:\n\n"""\n${assetText}\n"""`,
  });
}
