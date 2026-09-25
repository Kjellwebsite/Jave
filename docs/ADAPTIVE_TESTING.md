# Adaptive Testing

How JVLN chooses the next item, estimates ability and decides when to stop. The research basis is in `RESEARCH.md` §3–§5.

## Model

JVLN uses the **three-parameter logistic model** on the logistic metric (D = 1):

```
P(correct | θ) = c + (1 − c) / (1 + exp(−a (θ − b)))
```

| Parameter | Meaning | Where it comes from today |
|---|---|---|
| `a` | discrimination | Provisional default per paradigm (typically 1.2–2.0) |
| `b` | difficulty on the θ scale | Provisional, predicted from the item's complexity features |
| `c` | lower asymptote | `1/k` for k-option multiple choice, `0` for constructed responses |

Constructed-response items (numbers, strings, move counts, typed sequences) have `c = 0`, which is one reason JVLN prefers them.

Every item carries `calibration: 'provisional' | 'calibrated'`. Today **all** parameters are provisional. The engine treats provisional and calibrated parameters the same way, but the report says which kind produced a score.

### The internal difficulty scale

θ is centred so that 0 means "difficulty of an item a typical adult solves with 50% probability", with 1 unit meant to correspond to one population SD **once calibrated**. The difficulty bands are internal targets for item authoring:

| Band | θ range | Conventional reference (not a claim) |
|---|---|---|
| Foundation | −1.33 to 0 | ~80–100 |
| Standard | 0 to 1 | ~100–115 |
| Advanced | 1 to 2 | ~115–130 |
| Elite | 2 to 3 | ~130–145 |
| Apex | ≥ 3 | ~145–160+ |

The right-hand column only shows what the band is *aiming at* on a conventional mean-100/SD-15 scale. JVLN never displays these numbers as a person's score. A difficult item is not a validated measurement of a 150-level ability until calibration shows it behaves that way.

## Estimation

- **Method:** EAP on a fixed grid of θ from −4 to +6 in steps of 0.02.
- **Prior:** Normal(μ, 1.25²). μ = 0 at the start of a domain. Later paradigms in the same domain use the domain's current estimate for *selection only*; the reported paradigm estimate always starts from the neutral prior, so the order of sections does not leak into facet scores.
- **Standard error:** the posterior SD.
- **Interval:** θ̂ ± 1.645·SE (90%).
- **Why SD 1.25:** EAP shrinks extreme scores toward the prior mean (Bock & Mislevy, 1982). A slightly wider prior reduces this for high performers and still gives finite estimates for all-correct patterns. The choice is documented and can be changed in one constant.

Three estimates are maintained per session:

1. **Paradigm θ** from that paradigm's items only. This is the facet estimate.
2. **Domain θ** from all items in the domain, assuming one dimension per domain.
3. **General θ (g)** from all items in core domains pooled. This is a unidimensional approximation of the general factor. It is not a weighted average of domain scores, so it does not depend on assumed domain intercorrelations.

## Item selection

At each step:

1. **Candidate set.**
   - *Generated paradigms:* each difficulty level is a template with its own (a, b, c). The candidates are the levels.
   - *Authored banks:* the candidates are items not yet seen in this session, and preferably never seen on this device.
2. **Content balancing (authored banks).** If the paradigm defines facet targets, restrict the candidates to the facet with the largest deficit against its target share (Kingsbury & Zara, 1989).
3. **Information.** Compute Fisher information at the current selection θ for every candidate.
4. **Randomesque choice.** Pick uniformly among the top `k` candidates (default k = 2 for levels, 3 for banks), considering only those within 85% of the best information. This spreads exposure and makes the next item less predictable without wasting much precision.
5. **Warm start.** The first item of a paradigm targets θ = the domain's current estimate, clamped to [−1, 1]. Nobody starts on an extreme item.
6. **Step limit.** Early in a paradigm the target may move at most 1.5 θ units from the previous item's b. This prevents a single lucky or unlucky response from causing a jarring jump.

Generated items are instantiated from a seeded RNG (`sessionSeed ⊕ stepIndex`). An interrupted session can therefore be regenerated exactly, and an item can be reproduced for review.

## Stopping rules

A paradigm stops at the first of:

| Rule | Quick | Core | Full |
|---|---|---|---|
| SE ≤ target **and** n ≥ minimum | SE 0.50, n ≥ 4 | SE 0.42, n ≥ 5 | SE 0.36, n ≥ 6 |
| n = maximum | 7 | 10 | 14 |
| Time budget reached | per paradigm | per paradigm | per paradigm |

With provisional `a ≈ 1.5–2`, about 8–12 well-targeted items reach SE ≈ 0.40. The thresholds are deliberately modest: a long battery across 11 domains cannot reach SE 0.30 everywhere without taking hours. The report shows the achieved SE, so a user can see which estimates are rough.

## Ceiling and floor

- **Ceiling:** the paradigm's hardest level was administered, the estimate lies above that level's b minus 0.5, and the last two responses at the top were correct. The estimate is then a lower bound, and the report shows it as "≥".
- **Floor:** the mirror case at the easiest level.

## Response-time effort

Responses faster than a paradigm-specific minimum plausible time are **rapid guesses** (Wise & Kong, 2005). They are excluded from θ estimation, counted in the session's integrity summary, and do not end the paradigm. If more than 30% of a paradigm's responses are rapid, that paradigm's estimate is marked unreliable.

## Exposure

- Generated items are unique instances, so exposure is tracked **per template level**.
- Authored items record exposure counts locally so that a retake prefers unseen items.
- Server-side Sympson–Hetter control requires a backend and live data. The `exposureControl` fields exist in the schema, but it is not active.

## Moving to calibrated parameters

1. Collect first-attempt responses with full item metadata (`docs/SCORING.md` → data export).
2. Fit 2PL/3PL (or a bifactor MIRT model) per paradigm, for example with the `mirt` R package.
3. For generators, regress the fitted b on the complexity features. This updates the feature-to-b formula, so every future instance inherits calibrated predictions.
4. Replace `calibration: 'provisional'` with `'calibrated'` and store the parameter version on every response.
5. Re-run the simulation tests in `tests/adaptive.sim.test.ts` with the new bank to verify bias and RMSE across θ.
