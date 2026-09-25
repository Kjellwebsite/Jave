# Psychometric Design

This document defines what JVLN measures, how each measurement relates to established constructs, and how scores should be interpreted. The evidence behind it is in `RESEARCH.md`.

## Construct model

JVLN follows a hierarchical model informed by CHC theory (Carroll, 1993; Schneider & McGrew, 2018):

```
                        General θ (g, core domains only)
                                   │
   ┌──────────┬──────────┬─────────┼─────────┬──────────┬──────────┐
Reasoning  Quant/Prob  Memory  Executive  Learning  Strategic  Social  Language   … Adaptive/Natural (experimental)
   │
 facets = paradigms (matrix inference, sequence induction, relational deduction, transformation analogies …)
```

Domains group facets that share a broad ability. Facets are the paradigms. Each facet has its own θ estimate.

### The eleven domains

| # | Domain | CHC anchor | Status | IRT-scored paradigms | Performance paradigms |
|---|---|---|---|---|---|
| 01 | Reasoning | Gf (induction, deduction) | Core | Matrix inference, sequence induction, relational deduction, transformation analogies | — |
| 02 | Quantitative & Probabilistic | Gf-RQ, Gq | Core | Balance systems, probabilistic reasoning | — |
| 03 | Memory | Gwm, Gl | Core | Spatial span, verbal manipulation span | N-back updating, paired associates with delayed recall |
| 04 | Attention & Processing | Gs, attentional control | Performance only | — | Choice reaction, visual search, sustained attention |
| 05 | Executive Function | Shifting, inhibition, planning (Miyake et al., 2000) | Core | Planning (one-touch tower) | Task switching, flanker interference, rule discovery |
| 06 | Learning | Gl, concept learning | Core | Hidden-rule category learning (problem outcomes) | Reversal learning |
| 07 | Strategic | Gf applied to game trees and incentives | Core | Backward induction games, strategic scenarios | — |
| 08 | Metacognition | Confidence–accuracy relationship | Metrics only | — | Embedded confidence probes |
| 09 | Social Cognition | Theory of mind, social inference | Core | Recursive belief tracking, social inference scenarios | — |
| 10 | Language | Gc (knowledge) and verbal Gf (reasoning) | Core | Semantic relations (knowledge), artificial-language induction and precise reading (reasoning) | — |
| 11 | Adaptive / Natural | Gv spatial orientation, pattern recognition | **Experimental** | Orientation, specimen anomaly detection | — |

### Separate applied sections (never in the core composite)

| Section | What is scored | What is *not* scored |
|---|---|---|
| Performance | Reaction time, typing speed (WPM) and accuracy, dual-task costs, consistency | — |
| Creativity | Remote associates (objective), fluency and constraint adherence | Originality and flexibility need reference data or trained raters, so they show as *Calibration required* |
| AI / Prompting | Objective items on constraint handling, decomposition, prompt debugging, output evaluation and delegation | — |
| Visual / Design | Alignment and spacing precision, grouping | Aesthetic preference |

Creativity correlates only modestly with intelligence (Kim, 2005, r ≈ .17). Prompting and design are skills, not broad abilities. None of these enter *g*.

## Knowledge versus reasoning

Language items carry a `load: 'knowledge' | 'reasoning'` tag:

- **Knowledge:** semantic relations with rare vocabulary. This measures Gc. It depends on education and on English exposure.
- **Reasoning:** artificial-language induction (all information is on screen) and precise reading of instructions. This measures verbal reasoning.

The report shows both separately, so a non-native speaker can see whether a low Language estimate comes from knowledge items.

## Why these paradigms

Each paradigm was chosen because it (1) has a published measurement tradition, (2) can be scored objectively, (3) has a complexity model that allows a deep difficulty range, and (4) works in a browser. See `TASK_DESIGN.md` for the full specifications.

The upper tail comes from **structural** difficulty:

| Paradigm | What makes the hardest items hard |
|---|---|
| Matrix inference | Two components with independent rule sets, arithmetic and set-operation rules, 5–8 simultaneous rules |
| Sequence induction | Nested and interleaved recurrences, third-order differences, operations that depend on position |
| Relational deduction | 6–7 terms, indeterminacy (reasoning over every consistent ordering), negations, two dimensions |
| Transformation analogies | Compositions of 3–4 operations inferred from a single example, conditional operations |
| Balance systems | 4 unknowns, elimination across several scales, inequalities |
| Probabilistic reasoning | Base rates in probability format, sequential Bayesian updating, Simpson's paradox |
| Spatial / verbal span | 9–10 element sequences, backward order, sorting under load |
| Planning | 7–10 move problems with counter-intuitive moves and goal-hierarchy conflicts, solved without moving pieces |
| Backward induction | Irregular move sets, deep game trees, misère play, sums of games |
| Belief tracking | 4th–5th order nested beliefs, secret observers, several moves |
| Artificial language | 3–4 interacting morphological and word-order rules |
| Orientation | Heading opposite to the map's north, hidden map, relative directions |

## Interpretation rules

1. **Estimate, not truth.** A θ estimate describes performance on the measured items under the test conditions.
2. **Uncertainty always shown.** Every θ has an SE and a 90% interval. Ranks are shown as a *range* whenever the interval spans more than one rank.
3. **Provisional parameters.** Until calibration, θ is on a *provisional* scale defined by predicted item difficulty. Rank letters derived from it carry the label **Provisional · unnormed**. No percentile is displayed.
4. **Performance metrics are raw.** Reaction times, costs, d′, WPM and learning rates are shown as raw values, with reference ranges from published studies where available and the reliability caveats that apply. They are never converted into ranks without norms.
5. **Difference scores are fragile.** Switch costs, flanker effects and dual-task costs have low reliability for individuals (Hedge, Powell & Sumner, 2018). The report says so next to them.
6. **Metacognition is relative.** Calibration and confidence resolution describe the relationship between confidence and accuracy in this session. They are shown with bootstrap intervals and no rank.

## Reliability and validity plan

| Evidence | How it will be obtained |
|---|---|
| Internal consistency / marginal reliability | From posterior SEs across calibrated sessions: ρ ≈ 1 − mean(SE²)/var(θ̂) |
| Test–retest | Invite a random subset to retake after 2–4 weeks with an alternate form. Report the correlation and the practice gain. |
| Structural validity | Confirmatory bifactor model on the domain scores: does *g* plus domain factors fit? Is Adaptive/Natural distinct from Gv and Gf? |
| Convergent validity | Correlate with ICAR-16 (public domain), administered as an optional study module |
| Discriminant validity | Creativity and applied modules should correlate less with *g* than the core domains do |
| Fairness | Differential item functioning by device, language background and age band before any item is marked calibrated |
