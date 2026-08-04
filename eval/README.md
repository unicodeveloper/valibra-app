# Evaluation harness

Measures whether a change to the pipeline made review **better or just different**.

The pipeline is nondeterministic. The same asset can decompose into a different
claim set, and the same claim can draw different evidence, so a single run
cannot distinguish a fix from noise. Every asset is therefore run `--runs` times
and the harness reports **spread alongside the mean**. Instability is a metric
here, not an inconvenience.

## Why the clean set exists

Until now every sample in this repo was engineered to flag. Tuning only on copy
that *should* produce findings optimises sensitivity and never measures
specificity, which is exactly how a tool ends up returning 19 findings on an
ISI transcribed from approved labeling. The `clean` assets are copy a reviewer
should be able to run through the tool and get **nothing critical** back. That
number is the headline metric.

## Corpus format

One JSON file per asset in `corpus/`:

```jsonc
{
  "id": "clean-ozempic-isi",
  "kind": "clean",              // "clean" | "defective"
  "name": "Ozempic consumer ISI",
  "provenance": "Where this copy came from and how faithful it is to labeling",
  "assetText": "...",
  "expect": {
    "maxCritical": 0,           // clean: the bar this asset must clear
    "categories": []            // defective: finding categories that MUST appear
  }
}
```

`clean` assets assert an upper bound on critical findings. `defective` assets
assert both that specific finding categories are produced and, via
`expect.flaggedClaims`, that each named claim draws a critical-or-warning
finding **in every run**. Category presence alone proved a weak proxy: it once
scored 100% while a claim was going entirely unflagged.

Some FDA findings are about the **totality** of a set of claims rather than any
one of them. Amvuttra's untitled letter says so explicitly. Asserting that a
particular sentence must flag would then be stricter than what FDA actually
found, so those assets use `expect.totality` instead:

```jsonc
"totality": {
  "claims": ["...", "..."],
  "minFlagged": 3,
  "why": "the quote from the letter establishing that the finding is about the set"
}
```

At least `minFlagged` of the set must draw a flag in every run. A corpus that
overstates its own authority is no better than one that invents it.

## Running

Requires the dev server (`npm run dev`) and a local `DATABASE_URL`. The harness
clears the anonymous-trial meter before starting, using the same guard as
`scripts/reset-trial.mjs`: it refuses a non-local database.

```bash
npm run eval                      # whole corpus, 2 runs each
npm run eval -- --runs 3          # more repeats, tighter spread estimate
npm run eval -- --only clean      # just the specificity set
npm run eval -- --only ozempic    # substring match on asset id
```

Results are written to `results/<timestamp>.json` and `results/latest.json`.

## Metrics

| Metric | Meaning |
|---|---|
| `criticalsPerRun` | Critical findings per run. On `clean`, this is the false-positive rate. |
| `recall` | Fraction of expected categories produced, over defective assets. |
| `claimSpread` | max − min claims across runs for one asset. 0 = stable extraction. |
| `verdictAgreement` | Fraction of claims whose verdict was identical across every run. |
| `zeroSourceClaims` | Claims where retrieval returned nothing **and reported no error**, a silent failure the reviewer cannot see. |
| `hardFailures` | Runs that never returned a result (e.g. the model's content filter rejecting oncology safety copy). |

## Status of the clean set

The clean assets here are derived from public prescribing information and are a
**starting point, not an authority**. They were assembled by the same process
that produced the bugs they are meant to catch, so they encode its assumptions.
A clean corpus reviewed, or better written, by a regulatory ad/promo
professional is what would make the specificity number credible to one.
