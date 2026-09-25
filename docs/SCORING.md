# Scoring

How responses become estimates, how estimates become ranks, and what the report shows. The implementation lives in `src/adaptive/` and `src/scoring/`.

## 1. Item scoring

| Response type | Rule |
|---|---|
| Choice | Correct if the chosen option index equals the key |
| Number | Correct on an exact integer match after trimming |
| Text / sequence | Correct on an exact match after normalisation (lowercase, spaces and separators removed) |
| Timeout | Incorrect |
| Rapid guess (RT below the paradigm minimum) | Excluded from estimation, reported under integrity |
| Voided (the page was reloaded while the item was open) | Not a response; logged as an event |

## 2. Ability estimates

All estimates are EAP on a grid from −4 to +6, with a Normal(0, 1.25²) prior (see `ADAPTIVE_TESTING.md`). Estimates exist at three levels:

- **Facet θ** — one paradigm
- **Domain θ** — all IRT items in the domain
- **General θ** — all IRT items in core domains, excluding the *experimental* Adaptive/Natural domain

Each estimate carries:

```
theta        posterior mean
se           posterior SD
interval90   theta ± 1.645·se
n            items used
ceiling      boolean (see ADAPTIVE_TESTING.md)
floor        boolean
rapid        number of rapid guesses excluded
calibration  'provisional' | 'calibrated'
```

**Display rule:** an estimate based on fewer than 3 items is shown as *Insufficient data*, with no θ and no rank.

## 3. Ranks

### Thresholds

The ranks use the thresholds from the product brief, expressed as z on a population-standardised θ:

| Rank | z from | z to |
|---|---|---|
| S | 3.090 | — |
| A+ | 2.835 | 3.090 |
| A | 2.581 | 2.835 |
| A− | 2.326 | 2.581 |
| B+ | 2.099 | 2.326 |
| B | 1.872 | 2.099 |
| B− | 1.645 | 1.872 |
| C+ | 1.377 | 1.645 |
| C | 1.110 | 1.377 |
| C− | 0.842 | 1.110 |
| D+ | 0.561 | 0.842 |
| D | 0.281 | 0.561 |
| D− | 0 | 0.281 |
| F | — | 0 |

A, B, C and D are split into three equal z-intervals.

### Provisional mode (current)

- z = θ on the provisional scale.
- The rank letter is labelled **Provisional · unnormed**.
- A **rank range** is shown from the two ends of the 90% interval, for example "B− to A".
- **No percentile is shown anywhere.**
- Ceiling estimates are shown as "at least".

### Normed mode (future)

- A norm table maps θ to percentiles per paradigm, domain and general factor, optionally by age band.
- `scoring/rank.ts` takes an optional `NormTable`. When one is present, ranks come from normed percentiles and the provisional label disappears.

## 4. Performance metrics

Performance metrics are reported raw, with units, the number of trials used and a reliability note where the literature calls for one. They never become ranks until norms exist.

| Metric | Computation |
|---|---|
| Median RT | Correct trials, RT between 150 ms and 3 SD above the person's mean (log scale) |
| RT variability | Coefficient of variation of correct RTs |
| Inverse efficiency | Mean correct RT / proportion correct |
| Switch cost | Median RT(switch) − median RT(repeat), in mixed blocks |
| Mixing cost | Median RT(repeat, mixed) − median RT(pure) |
| Bin score | Draheim et al. (2016): trials are ranked into deciles against the person's own non-switch RT distribution; errors get the worst bin |
| Flanker effect | RT(incongruent) − RT(congruent); errors reported separately |
| Search slope | OLS slope of correct RT on set size, separately for present and absent |
| d′ | z(H) − z(FA), with a log-linear correction for 0 and 1 rates |
| Dual-task cost (pDTC) | (dual − single) / single × 100, sign-adjusted so positive means worse |
| WPM | (correct characters / 5) / minutes; net WPM subtracts uncorrected errors per minute |
| Learning rate | Rescorla–Wagner α and β, maximum likelihood on a 50 × 50 grid |

## 5. Metacognition

For the n items with a confidence rating (confidence c ∈ [0, 1], outcome o ∈ {0, 1}):

- **Bias** = mean(c) − mean(o). A positive value means overconfidence.
- **Brier** = mean((c − o)²), decomposed (Murphy, 1973) into reliability, resolution and uncertainty over confidence bins of 0.1.
- **Type-2 AUROC** = P(c on a correct item > c on an incorrect item), with ties counted as ½.
- **Intervals** are 90% bootstrap intervals with 1,000 resamples, seeded.
- **Minimum n:** 12 ratings with at least 3 correct and 3 incorrect. Below that, the report shows *Insufficient data*.

Descriptive labels come from the interval, not from norms:

- *Well calibrated* — the bias interval includes 0.
- *Overconfident* — the interval lies entirely above 0.
- *Underconfident* — the interval lies entirely below 0.
- *Confidence discriminates* — the AUROC interval lies entirely above 0.5.

## 6. Report structure

| Section | Content |
|---|---|
| Summary | General θ as a provisional rank and range, SE, domains completed, total items and duration |
| Core profile | Polar profile of domain estimates with interval bands; experimental domains drawn differently |
| Domain scores | For each domain: rank and range, θ, SE, n, flags, and the facets behind it |
| Facets | For each paradigm: θ, SE, n, highest level reached and the ceiling flag |
| Performance | RT, search, sustained attention, switching, interference, dual-task, typing |
| Learning | Category learning curves, transfer, retention and reversal-learning parameters |
| Metacognition | Bias, Brier components, AUROC and a calibration curve |
| Creativity | Remote associates, fluency and constraint adherence; originality marked *Calibration required* |
| Applied | Prompting and layout items |
| Uncertainty | Domains ranked by SE, ceiling/floor flags and estimates with too few items |
| Test conditions | Device class, input type, interruptions, voided items, rapid guesses, reduced motion and total time |

## 7. Export

The report page exports the full session as JSON: items with features and parameters, responses, events and estimates. This is the format the calibration pipeline expects.
