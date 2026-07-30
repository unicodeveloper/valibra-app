/**
 * Sample assets for the demo.
 *
 * These are real, approved drugs on purpose: the whole point of the review is
 * "check every claim against the evidence", so the samples have to be things
 * the Valyu lanes can actually retrieve — ClinicalTrials, PubMed, DailyMed,
 * FAERS, SEC. Each one is written like a real promotional sales aid, with a
 * deliberate mix of claims that *should* verify against the primary source and
 * claims that *should* flag (off-label creep, omitted boxed warnings,
 * unsupported superiority, unverifiable market claims, thin fair-balance).
 *
 * The copy is illustrative, not lifted from any real piece — but every drug,
 * indication and trial referenced is real, so the audit trail lights up.
 */
export type SampleAsset = {
  /** Stable id for keys. */
  id: string;
  /** Prefilled into the "Asset name" field when this sample is loaded. */
  name: string;
  /** The drug under review — shown in the menu. */
  drug: string;
  /** One line on what this sample is engineered to surface. */
  hint: string;
  /** The promotional copy that goes into the review. */
  text: string;
};

export const SAMPLE_ASSETS: SampleAsset[] = [
  {
    id: "ozempic",
    name: "Ozempic HCP detail aid",
    drug: "Ozempic (semaglutide)",
    hint: "Off-label weight-loss creep · omitted boxed warning · market claim",
    text: `OZEMPIC (semaglutide) injection: Take control of your type 2 diabetes, once weekly

- OZEMPIC lowers A1C by up to 1.8% in adults with type 2 diabetes.
- In a head-to-head trial, OZEMPIC reduced A1C more than dulaglutide (Trulicity).
- OZEMPIC reduces the risk of major cardiovascular events, including heart attack, stroke, and cardiovascular death, in adults with type 2 diabetes and established heart disease.
- Patients lost significant weight on OZEMPIC, the #1 prescribed GLP-1 for weight loss.
- Once-weekly dosing you take on any day, with or without meals.
- Generally well tolerated, so you can stay on track.

Ask your healthcare provider if OZEMPIC is right for you.`,
  },
  {
    id: "humira",
    name: "Humira RA sales aid",
    drug: "Humira (adalimumab)",
    hint: "Boxed-warning omission · unsupported safety · #1-biologic market claim",
    text: `HUMIRA (adalimumab): Proven relief across moderate-to-severe rheumatoid arthritis

- HUMIRA, with methotrexate, significantly reduces the signs and symptoms of moderate-to-severe rheumatoid arthritis and slows structural joint damage.
- In clinical trials, up to twice as many patients achieved an ACR50 response versus methotrexate alone.
- As the #1 prescribed biologic worldwide, HUMIRA is trusted by more rheumatologists than any other therapy.
- HUMIRA works by blocking TNF-alpha, a key driver of the inflammatory process.
- Now proven to keep patients in remission for years, with no meaningful safety trade-offs.
- A convenient self-administered injection every other week.

Talk to your doctor about starting HUMIRA today.`,
  },
  {
    id: "keytruda",
    name: "Keytruda NSCLC detail aid",
    drug: "Keytruda (pembrolizumab)",
    hint: "PD-L1 biomarker · MoA depth · first-in-class/IP · off-label breadth",
    text: `KEYTRUDA (pembrolizumab): Redefining survival in advanced non-small cell lung cancer

- In first-line metastatic NSCLC, KEYTRUDA plus chemotherapy significantly improved overall survival versus chemotherapy alone.
- KEYTRUDA is the first-in-class PD-1 inhibitor, a breakthrough with no comparable alternative.
- It works best in patients whose tumors express PD-L1, but delivers benefit across all comers regardless of biomarker status.
- By blocking the PD-1 pathway, KEYTRUDA restores the immune system's ability to find and fight cancer cells.
- Proven to extend life across dozens of tumor types.
- Well tolerated, with a manageable safety profile.

Ask your oncologist about KEYTRUDA.`,
  },
  {
    id: "eliquis",
    name: "Eliquis AFib sales aid",
    drug: "Eliquis (apixaban)",
    hint: "Comparative vs warfarin (has H2H) · drug-interaction claim · boxed warning",
    text: `ELIQUIS (apixaban): Superior stroke protection for patients with atrial fibrillation

- In patients with nonvalvular atrial fibrillation, ELIQUIS reduced the risk of stroke and systemic embolism more than warfarin.
- ELIQUIS also caused significantly less major bleeding than warfarin.
- As the #1 prescribed oral anticoagulant, ELIQUIS is the clear choice for AFib.
- No routine blood monitoring and no dietary restrictions.
- ELIQUIS can be combined with any medication without concern for interactions.
- Simple twice-daily oral dosing.

Ask your cardiologist whether ELIQUIS is right for you.`,
  },
];

/**
 * Back-compat default export — the first sample. Existing imports of
 * `SAMPLE_ASSET` (initial textarea state) keep working unchanged.
 */
export const SAMPLE_ASSET = SAMPLE_ASSETS[0].text;
