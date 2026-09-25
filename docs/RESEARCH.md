# JVLN Intelligence: Research Basis

This document is the research gate for the JVLN rebuild. It records what the literature says, what the product may claim, and how each finding changes the design. Every design decision in `ARCHITECTURE.md`, `PSYCHOMETRICS.md`, `ADAPTIVE_TESTING.md`, `SCORING.md` and `TASK_DESIGN.md` points back to a section here.

**How sources were checked.** Citations were verified against publisher, ERIC, ACL Anthology, CVF, APA and university pages in September 2026. Where a detail could not be confirmed from a primary page it is marked *(unverified)*. Formulas used in code were additionally checked numerically.

---

## Contents

1. [Standards and the claims we may make](#1-standards-and-the-claims-we-may-make)
2. [Structure of cognitive ability](#2-structure-of-cognitive-ability)
3. [Measurement theory: CTT and IRT](#3-measurement-theory-ctt-and-irt)
4. [Ability estimation](#4-ability-estimation)
5. [Computerized adaptive testing](#5-computerized-adaptive-testing)
6. [Item generation and cognitive models of difficulty](#6-item-generation-and-cognitive-models-of-difficulty)
7. [Answer-set leakage in generated items](#7-answer-set-leakage-in-generated-items)
8. [Paradigms by domain](#8-paradigms-by-domain)
9. [Response times, browsers and devices](#9-response-times-browsers-and-devices)
10. [Metacognition](#10-metacognition)
11. [Test-taking behavior and integrity](#11-test-taking-behavior-and-integrity)
12. [Norms, percentiles and the rank system](#12-norms-percentiles-and-the-rank-system)
13. [Privacy](#13-privacy)
14. [What JVLN must not claim](#14-what-jvln-must-not-claim)
15. [Measurement risks](#15-measurement-risks)
16. [Recommendations for future calibration](#16-recommendations-for-future-calibration)
17. [References](#17-references)

---

## 1. Standards and the claims we may make

**Sources.** AERA, APA & NCME (2014) *Standards for Educational and Psychological Testing*; International Test Commission (2001, 2006, 2018).

**Findings**

- The *Standards* require that score interpretations be supported by validity evidence for the intended use, and that precision be reported at the score level where decisions are made. Standard 2.14 asks for conditional standard errors at several score levels. For a CAT this means a person-level standard error, not one global reliability figure.
- The ITC guidelines on computer-based and internet-delivered testing distinguish four administration modes: open, controlled, supervised and managed. An anonymous browser test is **open mode**: identity, environment and effort are uncontrolled, so interpretations must be correspondingly limited.
- ITC test-use guidelines emphasise informed consent, clear score reports and test-taker rights. ITC adaptation guidelines state that translated versions need their own equivalence evidence. Item parameters do not transfer across languages automatically. JVLN is English-only for this reason.

**Design implications**

- Every score is shown with its uncertainty (standard error and interval).
- Results are framed as *estimated performance on the measured constructs*, never as "your IQ" or "your true intelligence".
- Anything that depends on norms that do not exist yet is labelled **Provisional** or **Calibration required**.

## 2. Structure of cognitive ability

**Sources.** Carroll (1993); Schneider & McGrew (2018); Deary (2012); Visser, Ashton & Vernon (2006); Waterhouse (2006); Miyake et al. (2000).

**Findings**

- Carroll's reanalysis of more than 460 datasets supports a three-stratum model: a general factor *g* at the top, about eight broad abilities in the middle and more than 69 narrow abilities at the bottom. The Cattell–Horn–Carroll (CHC) model (Schneider & McGrew, 2018) is the current consensus taxonomy. Its broad abilities include fluid reasoning (Gf), comprehension-knowledge (Gc), working memory (Gwm), visual processing (Gv), processing speed (Gs), learning efficiency (Gl) and retrieval fluency (Gr).
- *g* is robust and stable across the lifespan (Deary, 2012). Most well-constructed cognitive tests load substantially on it.
- Gardner's multiple intelligences lack adequate empirical support as independent abilities (Waterhouse, 2006). When Visser et al. (2006) tested all eight domains, linguistic, logical-mathematical, spatial, **naturalistic** and interpersonal tests all loaded strongly on *g*, and the non-*g* associations within domains were weak.
- Executive functions show *unity and diversity*: updating, shifting and inhibition are correlated but separable (Miyake et al., 2000).

**Design implications**

- The JVLN domains are organised as a CHC-informed profile under a general factor, not as independent "intelligences".
- **Adaptive / Natural Intelligence is an experimental JVLN construct.** It is not an established psychometric factor. Its tasks are ordinary spatial-orientation and pattern-recognition tasks set in natural contexts. It is shown in the profile but excluded from the core composite until validation data exist.
- Creativity, prompting skill, typing speed and visual-design judgment are reported in separate applied sections. They are not mixed into the core composite (see §8.9 and §8.12).

## 3. Measurement theory: CTT and IRT

**Sources.** Lord & Novick (1968); Rasch (1960); Birnbaum (1968); Lord (1980); Embretson & Reise (2000); Samejima (1969).

**Findings**

- Classical test theory models an observed score as true score plus error. It defines reliability as the ratio of true-score variance to observed-score variance. Reliability depends on the sample, and a single reliability coefficient hides that measurement precision varies along the ability range.
- Item response theory models the probability of a correct response as a function of a latent trait θ and item parameters. The three-parameter logistic model (3PL) is

  `P(θ) = c + (1 − c) / (1 + exp(−D·a·(θ − b)))`

  where *a* is discrimination, *b* difficulty and *c* the lower asymptote (guessing). *D* = 1.702 approximates the normal ogive; *D* = 1 gives the logistic metric.
- Item information for the 3PL (Birnbaum, 1968; Lord, 1980):

  `I(θ) = D²·a² · ((P − c)² / (1 − c)²) · ((1 − P) / P)`

  With *c* = 0 this reduces to `D²a²P(1−P)`, which peaks at θ = *b*. With *c* > 0 the peak moves above *b*:

  `θ_max = b + (1/(D·a)) · ln((1 + √(1 + 8c)) / 2)`

  The research agent confirmed both formulas numerically.
- Test information is the sum of item information, and the standard error of θ is `1/√I(θ)` for maximum-likelihood estimates. Precision is therefore a function of θ. This is the property that lets a CAT measure the upper tail well **if hard items exist**.
- Samejima's graded response model handles ordered polytomous outcomes such as partial credit.

**Design implications**

- Items carry `a`, `b` and `c` parameters and are selected on full Fisher information, not on *b* alone. With 8-option matrices, *c* ≈ .125 shifts the optimal item slightly above θ.
- Guessing is reduced where possible by using constructed responses (numbers, strings, move counts). Constructed responses have *c* = 0 and cannot be answered by elimination.

## 4. Ability estimation

**Sources.** Bock & Mislevy (1982); Warm (1989); Embretson & Reise (2000).

**Findings**

- **EAP** (expected a posteriori) estimation integrates the likelihood times a prior over fixed quadrature points. It is non-iterative and always exists, including for all-correct and all-wrong patterns where maximum likelihood diverges. The posterior standard deviation approximates the standard error.
- EAP **shrinks toward the prior mean**, most strongly at the extremes and in short tests. The regression of EAP on true θ has a slope of about the test's reliability (Bock & Mislevy, 1982). Very able examinees are therefore systematically *underestimated* by short CATs with a standard normal prior.
- **WLE** (Warm's weighted likelihood) has lower bias than ML with the same asymptotic variance, but it can be unstable for very short tests.
- Rule of thumb: with var(θ) = 1, SE 0.316 ≈ reliability .90, SE 0.40 ≈ .84, SE 0.50 ≈ .75.

**Design implications**

- JVLN uses EAP on a fixed grid (θ from −4 to +6) for selection and reporting, with a slightly wider prior (SD 1.25) to reduce upper-tail shrinkage.
- The report shows the posterior SD as the standard error and a 90% interval. It flags estimates whose interval reaches past the hardest items available (**ceiling**) or below the easiest (**floor**).

## 5. Computerized adaptive testing

**Sources.** Weiss & Kingsbury (1984); Wainer et al. (2000); van der Linden & Glas (2010); Babcock & Weiss (2012); Kingsbury & Zara (1989); Sympson & Hetter (1985); Chang & Ying (1999); Segall (1996); Ban et al. (2001).

**Findings**

- A CAT selects each item to be maximally informative at the current ability estimate, then updates the estimate. It reaches a target precision with far fewer items than a fixed form.
- **Stopping rules.** Standard-error rules outperform minimum-information or θ-convergence rules. Rules should be combined with a **minimum test length** and a maximum length (Babcock & Weiss, 2012). The specific SE thresholds they tested are *(unverified)*.
- **Content balancing.** Kingsbury & Zara's constrained CAT picks, at each step, the content area whose administered share is furthest below its target, then the most informative item within it.
- **Exposure control.** The randomesque method picks at random among the *n* most informative items. Sympson–Hetter gives each item a probability of being administered once selected, tuned by simulation. a-stratified selection saves high-*a* items for later in the test, when θ is better known (Chang & Ying, 1999).
- **Multidimensional CAT** matched unidimensional reliability with about a third fewer items when abilities correlate (Segall, 1996).
- **Online calibration.** New items can be seeded into live sessions and calibrated. Of the methods Ban et al. (2001) compared, MEM had the smallest recovery error at N = 300, 1,000 and 3,000.

**Design implications**

- The engine implements maximum-information selection with a randomesque choice among the top candidates, facet balancing for authored banks, and stopping on SE ≤ target *and* n ≥ minimum, or n = maximum, or the time budget.
- Domains are estimated as separate unidimensional θs (a *consecutive unidimensional* design). A general θ is estimated from all core items pooled. The item and response schema stores everything needed to move to MIRT later (Segall, 1996).
- New items are flagged `calibrationStatus: 'provisional'`. The schema supports seeding them for online calibration.

## 6. Item generation and cognitive models of difficulty

**Sources.** Carpenter, Just & Shell (1990); Embretson (1998); Primi (2001); Gierl & Haladyna (2012); Arendasy & Sommer (2005, 2013); Matzen et al. (2010); Condon & Revelle (2014).

**Findings**

- Carpenter et al. analysed how people solve Raven's matrices and described a small rule taxonomy: constant in a row, quantitative pairwise progression, figure addition/subtraction, distribution of three values and distribution of two values. High scorers differ mainly in inducing abstract relations and in managing many goals in working memory.
- Embretson (1998) generated a matrix item bank from that theory and **predicted item difficulty from design features**: the number and type of rules plus perceptual features. Primi (2001) found difficulty depends on the number of figures, the number of rules, rule complexity and perceptual organisation, with perceptual organisation having the strongest effect.
- Matzen et al. (2010) showed that generated matrices can cover **and extend** the difficulty range of Raven's Standard Progressive Matrices.
- Automatic item generation (Gierl & Haladyna, 2012) builds item models whose features predict difficulty. This allows *provisional* parameters before any response data exist, refined later by calibration.
- ICAR (Condon & Revelle, 2014) validated public-domain item types online (letter-number series, matrix reasoning, verbal reasoning, 3D rotation) with N = 96,958. It shows that open online cognitive measurement with a hierarchical *g* structure is feasible.

**Design implications**

- Every generator exposes explicit complexity features, such as the number of rules, rule types, premises, integration steps, recursion depth or search depth. It maps them to a provisional *b* with a documented, adjustable formula.
- Upper-tail difficulty comes from **more interacting rules, deeper dependency chains, recursion and search**, not from bigger numbers (see `TASK_DESIGN.md`).
- Provisional parameters are hypotheses. The item schema marks them as such until empirical calibration replaces them.

## 7. Answer-set leakage in generated items

**Sources.** Zhang et al. (2019) RAVEN; Hu et al. (2021) I-RAVEN; Arendasy & Sommer (2013); Le, Boureau & Nickel (2019).

**Findings**

- In the RAVEN dataset each distractor was made by changing one attribute of the correct answer. The answer is then the option holding the most common value of every attribute, and models trained **on the answer set alone** reached about 70–90% accuracy against a 12.5% chance level.
- I-RAVEN fixed this with an **attribute bisection tree**: each attribute split is balanced, so no option is modal.
- Arendasy & Sommer (2013) showed that reducing response-elimination strategies improves the construct validity of figural matrices.
- The same problem appears in theory-of-mind question answering. Earlier benchmarks could be solved from dataset regularities without tracking beliefs. ToMi (Le et al., 2019) controls the answer space explicitly.

**Design implications**

- Matrix distractors are built from a balanced 2×2×2 attribute design. Each modified attribute takes exactly one alternative value, which appears in half of the options. A unit test runs a **context-blind "majority" solver** on generated items and requires its accuracy to stay near chance.
- Generated theory-of-mind stories vary which location is correct across question orders. Every location in the options is one the object actually occupied, so options cannot be eliminated by surface cues.
- Wherever possible, a constructed response replaces multiple choice.

## 8. Paradigms by domain

For each domain: which paradigms have a measurement tradition, what they measure, and what the literature warns about.

### 8.1 Reasoning (fluid reasoning, Gf)

- **Matrix reasoning** is the canonical Gf marker (Carpenter et al., 1990). Generated matrices with rule-based difficulty models are well established (Embretson, 1998; Matzen et al., 2010). Answer-set balance is mandatory (§7).
- **Series completion.** ICAR's letter-number series show that number and letter series work online (Condon & Revelle, 2014). Difficulty rises with rule complexity and with the number of interleaved or nested rules.
- **Deductive reasoning** is studied with n-term series (relational reasoning) and syllogisms. Premise integration, indeterminacy and negation are the main sources of difficulty. Nonsense terms remove belief bias.
- **Analogies.** Letter-string analogies (Hofstadter & Mitchell, 1995) have canonical items that are deliberately ambiguous and are memorised by language models (Webb, Holyoak & Lu, 2023). JVLN therefore uses **generated transformation analogies**. Each item is checked by exhaustive search for a unique minimal transformation, and new instances are generated every session.

### 8.2 Quantitative and probabilistic reasoning

- Quantitative reasoning (Gf-RQ) is measured with problems that need relations, not calculation skill. Balance-scale systems give graded difficulty through the number of unknowns and the elimination steps required.
- Bayesian problems are much harder in probability format than in natural-frequency format (Gigerenzer & Hoffrage, 1995). Format is therefore a documented difficulty feature, and classic error patterns (base-rate neglect, inverse conditional) make principled distractors.

### 8.3 Memory (Gwm, Gl)

- **Corsi block tapping.** Standardised by Kessels et al. (2000). Backward Corsi is **not** harder than forward (Kessels et al., 2008), unlike digit span. JVLN gives both directions the same difficulty model.
- **Complex span** (e.g., automated operation span) has good reliability: α ≈ .78, retest ≈ .83 (Unsworth et al., 2005). It needs a processing-accuracy criterion (Conway et al., 2005).
- **N-back** is a poor measure of individual differences because of its low reliability (Jaeggi et al., 2010), and it correlates only weakly with span tasks (Kane et al., 2007). JVLN reports n-back only as a performance metric (d′ with lures), never as a ranked facet.
- **Delayed recall.** Associative learning at the start of the session with cued recall at the end separates encoding from retention.

### 8.4 Attention and processing speed (Gs)

- **Visual search.** Feature search is flat across set size, while conjunction search slopes upward (Treisman & Gelade, 1980). Slopes form a continuum (Wolfe, 1998). Use at least three set sizes and estimate the slope by regression.
- **Sustained attention (SART).** Commission errors are preceded by RT speeding (Robertson et al., 1997). Report commission and omission errors, RT variability and pre-error speeding.
- Speed measures depend on device latency (§9). They are therefore reported as performance metrics, not as ranked abilities.

### 8.5 Executive function

- **Unity and diversity.** Updating, shifting and inhibition are correlated but separable (Miyake et al., 2000).
- **Task switching.** Switch costs shrink with preparation but do not vanish (Monsell, 2003). Report switch cost and mixing cost separately.
- **Flanker interference** (Eriksen & Eriksen, 1974) is a robust effect but a poor individual-difference measure (Hedge et al., 2018).
- **Planning.** Tower of London difficulty depends on minimum moves, **search depth** (intermediate moves that do not put a ball in its goal position) and **goal hierarchy** (Kaller et al., 2004, 2012). JVLN computes all three for every generated problem. It uses a one-touch format (state the minimum number of moves without moving anything), which forces planning ahead and yields a constructed response.

### 8.6 Learning

- **Category learning.** Shepard, Hovland & Jenkins (1961) defined six structures over three binary dimensions. Their difficulty order is I < II < III = IV = V < VI, replicated by Nosofsky et al. (1994). This gives a validated difficulty ladder for rule acquisition.
- **Probabilistic reversal learning.** Hierarchically estimated computational parameters are reliable across sessions. Simple session-wise summary scores are less so (Waltmann et al., 2022). JVLN fits a Rescorla–Wagner model per person and reports the learning rate with an honest reliability caveat.

### 8.7 Strategic reasoning

Strategic reasoning is not a separate CHC factor. JVLN treats it as reasoning applied to multi-agent incentive structures:

- **Backward induction** in small combinatorial games. Positions can be solved exactly, which gives an objective key, and the depth of the game tree gives graded difficulty.
- **Incentive scenarios** where the best response follows from stated payoffs. They are written so that knowing game-theory terms is not required.

### 8.8 Metacognition

See §10.

### 8.9 Social cognition

- Classic theory-of-mind tasks often lack specificity. Many can be solved without representing another mind (Quesque & Rossetti, 2020), and question-answering versions can be solved from dataset regularities (Le et al., 2019).
- Reading the Mind in the Eyes has poor psychometric properties in large samples (Olderbak et al., 2015; Higgins et al., 2023). JVLN does not use face-based emotion recognition until a validated, licensed stimulus set is available.
- **Orders of intentionality.** Most adults handle 4th-order mental-state reasoning and performance drops around 5th order (Kinderman, Dunbar & Bentall, 1998; Stiller & Dunbar, 2007). Higher-order items need **memory-control questions**, because failures can reflect memory rather than mentalizing.
- Situational judgement formats (STEU/STEM; MacCann & Roberts, 2008) show that emotion understanding can be tested with objectively keyed scenarios.

**JVLN approach**

- **Generated recursive belief tracking.** Belief states are computed from an explicit model of who witnessed which event, and every item carries a memory-control question.
- **Authored scenarios** on intent, deception, manipulation, incentives and coalitions, each with one defensible keyed answer.

### 8.10 Language

- Vocabulary is the prototypical crystallised (Gc) marker, and it keeps rising through most of adulthood (Horn & Cattell, 1966). Verbal *reasoning* loads partly on Gf.
- **Artificial language learning** (Reber, 1967) lets language reasoning be measured without prior vocabulary. All the information needed is on screen.
- JVLN tags every language item as `knowledge` or `reasoning`.

### 8.11 Adaptive / Natural (experimental)

- There is no psychometric evidence for a distinct naturalistic intelligence (Visser et al., 2006). The measurable components are spatial orientation and pattern recognition in natural contexts.
- **Spatial orientation (perspective taking)** is separable from mental rotation (Kozhevnikov & Hegarty, 2001; Hegarty & Waller, 2004). A computerised Spatial Orientation Test exists (Friedman et al., 2020). Beyond about 90° of imagined rotation, people fall back on egocentric encoding.
- Browser path integration is visual only: vestibular and proprioceptive cues are absent (Loomis et al., 1993).

### 8.12 Applied: creativity, prompting, typing, design

- **Creativity.**
  - Compound remote associates have published norms: 144 problems with solution rates at 2, 7, 15 and 30 s (Bowden & Jung-Beeman, 2003).
  - Divergent thinking scored by uniqueness is confounded with fluency. Subjective "top-2" scoring by raters is more dependable (Silvia et al., 2008).
  - Fine-tuned LLM scoring reached r ≈ .81 with human raters, against r ≈ .12–.26 for semantic distance (Organisciak et al., 2023).
  - Creativity correlates only r ≈ .17 with IQ (Kim, 2005).
  - **Decision:** JVLN scores remote associates objectively. It records divergent-thinking responses with fluency and constraint adherence, and marks originality as *Calibration required*. No opaque LLM judgment is used.
- **Typing.** A study of about 168,000 volunteers found a mean of 51.6 WPM (SD 20.2) (Dhakal et al., 2018). Typing speed confounds any timed free-text task, so JVLN records it separately.
- **Prompting and visual design** have no psychometric literature as abilities. They are treated as skills, tested with objectively keyed items, and reported outside the core profile.

## 9. Response times, browsers and devices

**Sources.** Bridges et al. (2020); Anwyl-Irvine et al. (2021); de Leeuw & Motz (2016); Pronk et al. (2020); Hedge et al. (2018); Draheim et al. (2016, 2019).

**Findings**

- **Browsers add response lag.** Browser-based experiments add roughly 25–45 ms of lag with 5–10 ms trial-to-trial variability compared with native lab software (Bridges et al., 2020). JavaScript RTs ran 10–40 ms longer than Psychtoolbox, but the experimental effects were preserved (de Leeuw & Motz, 2016).
- **Hardware adds more.** In device tests, keyboard latencies averaged around 80 ms and reached about 100 ms on some hardware (Anwyl-Irvine et al., 2021, *via a secondary summary*). Touchscreens and keyboards both overestimate RT, with device-specific means and variances (Pronk et al., 2020).
- **Contrasts are safer than absolutes.** Within-person contrasts are less affected than absolute RTs, but contrasts are difference scores with poor reliability (Hedge et al., 2018).
- **Speed–accuracy tradeoffs** must be handled explicitly, for example with bin scores, inverse efficiency or accuracy-based designs (Draheim et al., 2016, 2019).

**Design implications**

- Record input type (touch or mouse and keyboard) with every response. Absolute RTs are never compared across input types.
- Stimulus onset is timestamped on the frame after the paint. Responses use `event.timeStamp`.
- RT metrics are reported as raw medians with a note on device latency. They never enter the core composite.
- Switch costs are also reported as bin scores, and flanker effects as inverse-efficiency differences, next to the raw RT costs.

## 10. Metacognition

**Sources.** Fleming & Lau (2014); Maniscalco & Lau (2012); Galvin et al. (2003); Lichtenstein, Fischhoff & Phillips (1982); Murphy (1973); Stankov & Crawford (1997).

**Findings**

Three quantities must be kept apart:

- **Bias:** mean confidence minus accuracy, i.e. over- or underconfidence.
- **Sensitivity:** how well confidence separates correct from incorrect answers, measured by type-2 AUROC or meta-d′.
- **Efficiency:** meta-d′/d′, which controls for task performance.

Further findings:

- People are typically overconfident, and more so on hard items (the hard–easy effect).
- The Brier score decomposes into reliability (calibration), resolution and uncertainty (Murphy, 1973).
- Confidence is a stable individual difference, correlated with accuracy but distinct from it (Stankov & Crawford, 1997).
- Type-2 measures are most interpretable when accuracy sits near 70–75%.

**Design implications**

- JVLN collects confidence (0–100%, "probability you are right") on a seeded subset of reasoning and quantitative CAT items.
- Adaptive item selection keeps accuracy in an informative middle range. That is also good for type-2 measures.
- The report shows bias, type-2 AUROC and Brier components with bootstrap intervals, and the number of rated items. It uses no labels such as "highly metacognitive" and no ranks.

## 11. Test-taking behavior and integrity

**Sources.** Wise & Kong (2005); Wise (2017); ITC (2006).

**Findings**

- **Rapid guessing.** Responses too fast to reflect engagement ("rapid guesses") can be separated from solution behaviour with item-level response-time thresholds. Response-time effort is a validated indicator of low motivation (Wise & Kong, 2005).
- In open-mode testing, identity and environment are uncontrolled. Integrity measures should detect and report problems, not surveil.

**Design implications**

- Every paradigm defines a minimum plausible response time. Rapid guesses are excluded from θ and reported.
- JVLN logs visibility changes, pauses, reloads and voided items. It does not record keystrokes outside tasks, camera, microphone, location or fingerprinting data.
- Sessions resume after a reload. An item that was on screen during the reload is voided and replaced, so nobody gains extra viewing time.

## 12. Norms, percentiles and the rank system

**Reference values.** On a mean-100, SD-15 scale:

| Upper tail | z | Scale value |
|---|---|---|
| 0.1% | 3.090 | 146.4 |
| 1% | 2.326 | 134.9 |
| 5% | 1.645 | 124.7 |
| 20% | 0.842 | 112.6 |
| 50% | 0 | 100 |

**Findings**

- A θ-to-percentile mapping is only valid when θ is scaled on a representative norm sample. An online convenience sample is not representative. For comparison, ICAR's online sample of about 97,000 was 66% female and self-selected.
- A standard error of 0.30 corresponds to ±4.5 points on a mean-100/SD-15 scale, and a 95% interval of about ±8.8 points. A claim such as "top 0.1%" therefore needs a small SE at high θ **and** enough hard items. EAP shrinkage understates extremes (§4).

**Design implications**

- The S–F rank system is implemented with the thresholds from the brief:
  - S: z ≥ 3.090
  - A: z ≥ 2.326
  - B: z ≥ 1.645
  - C: z ≥ 0.842
  - D: z ≥ 0
  - F: below 0
  - Each band except S and F is split into thirds for the + and − steps.
- Until norms exist, ranks are computed from θ **on the provisional scale**. They are displayed as **Provisional · unnormed**, with a rank range from the 90% interval and no percentile. When the calibration pipeline supplies norm tables, the same code path switches to them (`scoring/rank.ts`).

## 13. Privacy

**Findings**

- Embedding Google Fonts from Google's servers without consent was ruled a GDPR violation because it transmits the visitor's IP address to Google (LG München I, 20 January 2022, 3 O 17493/20). The court noted that the fonts could have been hosted locally.
- The ITC guidelines and the GDPR principle of data minimisation both favour collecting only what the measurement needs.

**Design implications**

- Fonts are self-hosted.
- No third-party requests.
- No account, no name, no email.
- Data stay on the device unless the user exports them.

## 14. What JVLN must not claim

- "This measures your IQ" or "your true intelligence."
- Any percentile or "top X%" before normative data exist.
- That an item "is 150-IQ difficulty." Items have *target bands* on a provisional scale.
- That naturalistic, social, strategic, prompting or design abilities are established psychometric factors equivalent to Gf or Gc.
- That RT metrics from a phone are comparable to desktop RTs.
- That creativity scores capture originality when they only count responses.
- Clinical, diagnostic, hiring or educational-placement use.

The permitted framing is: *"JVLN estimates your performance on the measured constructs. Estimates are provisional until the items are calibrated on a large sample."*

## 15. Measurement risks

| Risk | Mitigation |
|---|---|
| Provisional parameters are wrong, so θ is biased | Label as provisional; record all responses for calibration; simulation tests of estimator behaviour |
| Answer-set cues (§7) | Balanced answer sets; constructed responses; a context-blind solver test |
| Item ambiguity | Exhaustive uniqueness checks in generators; Item Review page; authored-item review checklist |
| Practice effects on retake | Attempt number stored; retakes flagged; generated items differ each time |
| Language and culture | Nonsense terms and figural content where possible; knowledge-loaded items tagged |
| Device effects on RT | Input type stored; no cross-device comparison; RT excluded from composites |
| Fatigue in long sessions | Section breaks; Quick and Core modes; resumable sessions |
| Low effort | Rapid-guess detection; unreliability flags |
| Low reliability of difference scores | Integrated scores alongside raw costs; explicit caveat in the report |
| Memory confound in higher-order theory-of-mind items | Memory-control question on every item; failures flagged |

## 16. Recommendations for future calibration

1. **Collect** first attempts with complete item metadata (parameters, features, version), device class and optional age band and English background.
2. **Screen** sessions for rapid guessing and interruptions before analysis.
3. **Calibrate** each paradigm with 2PL/3PL. Use at least 500 responses per item for authored items; for generated items, calibrate the *feature model* instead, so each level borrows strength across instances. Then fit a bifactor model across domains.
4. **Check** differential item functioning by device, language background and age band.
5. **Norm** on a sample weighted to a target population, with age-banded norms if the sample permits. Only then enable percentiles and non-provisional ranks.
6. **Validate** against ICAR-16 and a retest subsample. Publish the technical report.

## 17. References

- AERA, APA, & NCME. (2014). *Standards for educational and psychological testing*. American Educational Research Association. https://www.testingstandards.net/open-access-files.html
- Anwyl-Irvine, A., Dalmaijer, E. S., Hodges, N., & Evershed, J. K. (2021). Realistic precision and accuracy of online experiment platforms, web browsers, and devices. *Behavior Research Methods, 53*(4), 1407–1425. https://doi.org/10.3758/s13428-020-01501-5
- Babcock, B., & Weiss, D. J. (2012). Termination criteria in computerized adaptive tests. *Journal of Computerized Adaptive Testing, 1*(1), 1–18. https://doi.org/10.7333/1212-0101001
- Ban, J.-C., Hanson, B. A., Wang, T., Yi, Q., & Harris, D. J. (2001). A comparative study of on-line pretest item calibration/scaling methods in computerized adaptive testing. *Journal of Educational Measurement, 38*(3), 191–212. https://doi.org/10.1111/j.1745-3984.2001.tb01123.x
- Baron-Cohen, S., O'Riordan, M., Stone, V., Jones, R., & Plaisted, K. (1999). Recognition of faux pas by normally developing children and children with Asperger syndrome or high-functioning autism. *Journal of Autism and Developmental Disorders, 29*(5), 407–418. https://doi.org/10.1023/A:1023035012436
- Baron-Cohen, S., Wheelwright, S., Hill, J., Raste, Y., & Plumb, I. (2001). The "Reading the Mind in the Eyes" test revised version. *Journal of Child Psychology and Psychiatry, 42*(2), 241–251. https://doi.org/10.1111/1469-7610.00715
- Beaty, R. E., & Johnson, D. R. (2021). Automating creativity assessment with SemDis. *Behavior Research Methods, 53*(2), 757–780. https://doi.org/10.3758/s13428-020-01453-w
- Birnbaum, A. (1968). Some latent trait models and their use in inferring an examinee's ability. In F. M. Lord & M. R. Novick, *Statistical theories of mental test scores* (pp. 395–479). Addison-Wesley.
- Bock, R. D., & Mislevy, R. J. (1982). Adaptive EAP estimation of ability in a microcomputer environment. *Applied Psychological Measurement, 6*(4), 431–444. https://doi.org/10.1177/014662168200600405
- Bowden, E. M., & Jung-Beeman, M. (2003). Normative data for 144 compound remote associate problems. *Behavior Research Methods, Instruments, & Computers, 35*(4), 634–639. https://doi.org/10.3758/BF03195543
- Bridges, D., Pitiot, A., MacAskill, M. R., & Peirce, J. W. (2020). The timing mega-study. *PeerJ, 8*, e9414. https://doi.org/10.7717/peerj.9414
- Carpenter, P. A., Just, M. A., & Shell, P. (1990). What one intelligence test measures. *Psychological Review, 97*(3), 404–431. https://doi.org/10.1037/0033-295X.97.3.404
- Carroll, J. B. (1993). *Human cognitive abilities: A survey of factor-analytic studies*. Cambridge University Press.
- Chang, H.-H., & Ying, Z. (1999). a-Stratified multistage computerized adaptive testing. *Applied Psychological Measurement, 23*(3), 211–222. https://doi.org/10.1177/01466219922031338
- Condon, D. M., & Revelle, W. (2014). The International Cognitive Ability Resource. *Intelligence, 43*, 52–64. https://doi.org/10.1016/j.intell.2014.01.004
- Conway, A. R. A., Kane, M. J., Bunting, M. F., Hambrick, D. Z., Wilhelm, O., & Engle, R. W. (2005). Working memory span tasks: A methodological review and user's guide. *Psychonomic Bulletin & Review, 12*, 769–786. https://doi.org/10.3758/BF03196772
- de Leeuw, J. R., & Motz, B. A. (2016). Psychophysics in a Web browser? *Behavior Research Methods, 48*(1), 1–12. https://doi.org/10.3758/s13428-015-0567-2
- Deary, I. J. (2012). Intelligence. *Annual Review of Psychology, 63*, 453–482. https://doi.org/10.1146/annurev-psych-120710-100353
- Dhakal, V., Feit, A. M., Kristensson, P. O., & Oulasvirta, A. (2018). Observations on typing from 136 million keystrokes. *Proc. CHI 2018*. https://doi.org/10.1145/3173574.3174220
- Draheim, C., Hicks, K. L., & Engle, R. W. (2016). Combining reaction time and accuracy. *Perspectives on Psychological Science, 11*(1), 133–155. https://doi.org/10.1177/1745691615596990
- Draheim, C., Mashburn, C. A., Martin, J. D., & Engle, R. W. (2019). Reaction time in differential and developmental research. *Psychological Bulletin, 145*(5), 508–535.
- Embretson, S. E. (1998). A cognitive design system approach to generating valid tests. *Psychological Methods, 3*(3), 380–396. https://doi.org/10.1037/1082-989X.3.3.380
- Embretson, S. E., & Reise, S. P. (2000). *Item response theory for psychologists*. Erlbaum. https://doi.org/10.4324/9781410605269
- Eriksen, B. A., & Eriksen, C. W. (1974). Effects of noise letters upon the identification of a target letter in a nonsearch task. *Perception & Psychophysics, 16*, 143–149. https://doi.org/10.3758/BF03203267
- Fleming, S. M., & Lau, H. C. (2014). How to measure metacognition. *Frontiers in Human Neuroscience, 8*, 443. https://doi.org/10.3389/fnhum.2014.00443
- Friedman, A., Kohler, B., Gunalp, P., Boone, A. P., & Hegarty, M. (2020). A computerized spatial orientation test. *Behavior Research Methods, 52*, 799–812. https://doi.org/10.3758/s13428-019-01277-3
- Galvin, S. J., Podd, J. V., Drga, V., & Whitmore, J. (2003). Type 2 tasks in the theory of signal detectability. *Psychonomic Bulletin & Review, 10*, 843–876. https://doi.org/10.3758/BF03196546
- Gierl, M. J., & Haladyna, T. M. (Eds.). (2012). *Automatic item generation: Theory and practice*. Routledge. https://doi.org/10.4324/9780203803912
- Gigerenzer, G., & Hoffrage, U. (1995). How to improve Bayesian reasoning without instruction: Frequency formats. *Psychological Review, 102*(4), 684–704.
- Hedge, C., Powell, G., & Sumner, P. (2018). The reliability paradox. *Behavior Research Methods, 50*(3), 1166–1186. https://doi.org/10.3758/s13428-017-0935-1
- Hegarty, M., & Waller, D. (2004). A dissociation between mental rotation and perspective-taking spatial abilities. *Intelligence, 32*(2), 175–191. https://doi.org/10.1016/j.intell.2003.12.001
- Higgins, W. C., Ross, R. M., Langdon, R., & Polito, V. (2023). The "Reading the Mind in the Eyes" test shows poor psychometric properties in a large, demographically representative U.S. sample. *Assessment, 30*(6), 1777–1789. https://doi.org/10.1177/10731911221124342
- Hofstadter, D. R., & Mitchell, M. (1995). The Copycat project. In *Fluid concepts and creative analogies*. Basic Books.
- Horn, J. L., & Cattell, R. B. (1966). Refinement and test of the theory of fluid and crystallized general intelligences. *Journal of Educational Psychology, 57*(5), 253–270.
- Hu, S., Ma, Y., Liu, X., Wei, Y., & Bai, S. (2021). Stratified rule-aware network for abstract visual reasoning. *Proceedings of AAAI, 35*(2). https://ojs.aaai.org/index.php/AAAI/article/view/16248
- International Test Commission. (2001). International guidelines for test use. *International Journal of Testing, 1*(2), 93–114.
- International Test Commission. (2006). International guidelines on computer-based and internet-delivered testing. *International Journal of Testing, 6*(2), 143–171.
- International Test Commission. (2018). ITC guidelines for translating and adapting tests (2nd ed.). *International Journal of Testing, 18*(2), 101–134.
- Jaeggi, S. M., Buschkuehl, M., Perrig, W. J., & Meier, B. (2010). The concurrent validity of the N-back task as a working memory measure. *Memory, 18*(4), 394–412. https://doi.org/10.1080/09658211003702171
- Kaller, C. P., Unterrainer, J. M., Rahm, B., & Halsband, U. (2004). The impact of problem structure on planning. *Cognitive Brain Research, 20*, 462–472.
- Kaller, C. P., Unterrainer, J. M., & Stahl, C. (2012). Assessing planning ability with the Tower of London task. *Psychological Assessment, 24*(1), 46–53.
- Kane, M. J., Conway, A. R. A., Miura, T. K., & Colflesh, G. J. H. (2007). Working memory, attention control, and the N-back task. *JEP: LMC, 33*(3), 615–622. https://doi.org/10.1037/0278-7393.33.3.615
- Kessels, R. P. C., van Zandvoort, M. J. E., Postma, A., Kappelle, L. J., & de Haan, E. H. F. (2000). The Corsi Block-Tapping Task: Standardization and normative data. *Applied Neuropsychology, 7*(4), 252–258. https://doi.org/10.1207/S15324826AN0704_8
- Kessels, R. P. C., van den Berg, E., Ruis, C., & Brands, A. M. A. (2008). The backward span of the Corsi Block-Tapping Task. *Assessment, 15*(4), 426–434. https://doi.org/10.1177/1073191108315611
- Kim, K. H. (2005). Can only intelligent people be creative? A meta-analysis. *Journal of Secondary Gifted Education, 16*(2/3), 57–66. https://doi.org/10.4219/jsge-2005-473
- Kinderman, P., Dunbar, R., & Bentall, R. P. (1998). Theory-of-mind deficits and causal attributions. *British Journal of Psychology, 89*, 191–204.
- Kingsbury, G. G., & Zara, A. R. (1989). Procedures for selecting items for computerized adaptive tests. *Applied Measurement in Education, 2*(4), 359–375.
- Kozhevnikov, M., & Hegarty, M. (2001). A dissociation between object manipulation spatial ability and spatial orientation ability. *Memory & Cognition, 29*, 745–756. https://doi.org/10.3758/BF03200477
- Le, M., Boureau, Y.-L., & Nickel, M. (2019). Revisiting the evaluation of theory of mind through question answering. *Proceedings of EMNLP-IJCNLP 2019*, 5872–5877. https://aclanthology.org/D19-1598/
- LG München I. (2022, January 20). Urteil 3 O 17493/20 (Google Fonts).
- Lichtenstein, S., Fischhoff, B., & Phillips, L. D. (1982). Calibration of probabilities: The state of the art to 1980. In *Judgment under uncertainty* (pp. 306–334). Cambridge University Press.
- Loomis, J. M., et al. (1993). Nonvisual navigation by blind and sighted: Assessment of path integration ability. *JEP: General, 122*(1), 73–91.
- Lord, F. M. (1980). *Applications of item response theory to practical testing problems*. Erlbaum.
- MacCann, C., & Roberts, R. D. (2008). New paradigms for assessing emotional intelligence. *Emotion, 8*(4), 540–551. https://doi.org/10.1037/a0012746
- Maniscalco, B., & Lau, H. (2012). A signal detection theoretic approach for estimating metacognitive sensitivity from confidence ratings. *Consciousness and Cognition, 21*(1), 422–430. https://doi.org/10.1016/j.concog.2011.09.021
- Matzen, L. E., et al. (2010). Recreating Raven's. *Behavior Research Methods, 42*(2), 525–541. https://doi.org/10.3758/BRM.42.2.525
- Miyake, A., Friedman, N. P., Emerson, M. J., Witzki, A. H., Howerter, A., & Wager, T. D. (2000). The unity and diversity of executive functions. *Cognitive Psychology, 41*, 49–100.
- Monsell, S. (2003). Task switching. *Trends in Cognitive Sciences, 7*(3), 134–140. https://doi.org/10.1016/S1364-6613(03)00028-7
- Murphy, A. H. (1973). A new vector partition of the probability score. *Journal of Applied Meteorology, 12*(4), 595–600.
- Nosofsky, R. M., Gluck, M. A., Palmeri, T. J., McKinley, S. C., & Glauthier, P. (1994). Comparing models of rule-based classification learning. *Memory & Cognition, 22*, 352–369. https://doi.org/10.3758/BF03200862
- Olderbak, S., et al. (2015). A psychometric analysis of the Reading the Mind in the Eyes Test. *Frontiers in Psychology, 6*, 1503. https://doi.org/10.3389/fpsyg.2015.01503
- Olson, J. A., Nahas, J., Chmoulevitch, D., Cropper, S. J., & Webb, M. E. (2021). Naming unrelated words predicts creativity. *PNAS, 118*(25), e2022340118. https://doi.org/10.1073/pnas.2022340118
- Organisciak, P., Acar, S., Dumas, D., & Berthiaume, K. (2023). Beyond semantic distance: Automated scoring of divergent thinking greatly improves with large language models. *Thinking Skills and Creativity, 49*, 101356.
- Pashler, H. (1994). Dual-task interference in simple tasks. *Psychological Bulletin, 116*(2), 220–244. https://doi.org/10.1037/0033-2909.116.2.220
- Primi, R. (2001). Complexity of geometric inductive reasoning tasks. *Intelligence, 30*(1), 41–70.
- Pronk, T., Wiers, R. W., Molenkamp, B., & Murre, J. (2020). Mental chronometry in the pocket? *Behavior Research Methods, 52*(3), 1371–1382. https://doi.org/10.3758/s13428-019-01321-2
- Quesque, F., & Rossetti, Y. (2020). What do theory-of-mind tasks actually measure? *Perspectives on Psychological Science, 15*(2), 384–396. https://doi.org/10.1177/1745691619896607
- Rasch, G. (1960). *Probabilistic models for some intelligence and attainment tests*. Danish Institute for Educational Research.
- Reber, A. S. (1967). Implicit learning of artificial grammars. *Journal of Verbal Learning and Verbal Behavior, 6*, 855–863.
- Robertson, I. H., Manly, T., Andrade, J., Baddeley, B. T., & Yiend, J. (1997). 'Oops!'. *Neuropsychologia, 35*(6), 747–758. https://doi.org/10.1016/S0028-3932(97)00015-8
- Samejima, F. (1969). Estimation of latent ability using a response pattern of graded scores. *Psychometrika Monograph Supplement No. 17*.
- Schneider, W. J., & McGrew, K. S. (2018). The Cattell-Horn-Carroll theory of cognitive abilities. In *Contemporary intellectual assessment* (4th ed., pp. 73–163). Guilford.
- Segall, D. O. (1996). Multidimensional adaptive testing. *Psychometrika, 61*(2), 331–354. https://doi.org/10.1007/BF02294343
- Shepard, R. N., Hovland, C. I., & Jenkins, H. M. (1961). Learning and memorization of classifications. *Psychological Monographs, 75*(13), 1–42.
- Silvia, P. J., et al. (2008). Assessing creativity with divergent thinking tasks. *Psychology of Aesthetics, Creativity, and the Arts, 2*(2), 68–85.
- Stankov, L., & Crawford, J. D. (1997). Self-confidence and performance on tests of cognitive abilities. *Intelligence, 25*(2), 93–109.
- Stiller, J., & Dunbar, R. I. M. (2007). Perspective-taking and memory capacity predict social network size. *Social Networks, 29*(1), 93–104.
- Sympson, J. B., & Hetter, R. D. (1985). Controlling item-exposure rates in computerized adaptive testing. *Proceedings of the 27th Annual Meeting of the Military Testing Association*, 973–977.
- Treisman, A. M., & Gelade, G. (1980). A feature-integration theory of attention. *Cognitive Psychology, 12*, 97–136.
- Unsworth, N., Heitz, R. P., Schrock, J. C., & Engle, R. W. (2005). An automated version of the operation span task. *Behavior Research Methods, 37*(3), 498–505. https://doi.org/10.3758/BF03192720
- van der Linden, W. J., & Glas, C. A. W. (Eds.). (2010). *Elements of adaptive testing*. Springer. https://doi.org/10.1007/978-0-387-85461-8
- Visser, B. A., Ashton, M. C., & Vernon, P. A. (2006). Beyond g: Putting multiple intelligences theory to the test. *Intelligence, 34*(5), 487–502.
- Wainer, H. (Ed.). (2000). *Computerized adaptive testing: A primer* (2nd ed.). Erlbaum.
- Waltmann, M., Schlagenhauf, F., & Deserno, L. (2022). Sufficient reliability of the behavioral and computational readouts of a probabilistic reversal learning task. *Behavior Research Methods, 54*, 2993–3014.
- Warm, T. A. (1989). Weighted likelihood estimation of ability in item response theory. *Psychometrika, 54*(3), 427–450. https://doi.org/10.1007/BF02294627
- Waterhouse, L. (2006). Multiple intelligences, the Mozart effect, and emotional intelligence: A critical review. *Educational Psychologist, 41*(4), 207–225. https://doi.org/10.1207/s15326985ep4104_1
- Webb, T., Holyoak, K. J., & Lu, H. (2023). Emergent analogical reasoning in large language models. *Nature Human Behaviour*. https://doi.org/10.1038/s41562-023-01659-w
- Weiss, D. J., & Kingsbury, G. G. (1984). Application of computerized adaptive testing to educational problems. *Journal of Educational Measurement, 21*(4), 361–375.
- Wise, S. L. (2017). Rapid-guessing behavior: Its identification, interpretation, and implications. *Educational Measurement: Issues and Practice, 36*(4), 52–61. https://doi.org/10.1111/emip.12165
- Wise, S. L., & Kong, X. (2005). Response time effort: A new measure of examinee motivation in computer-based tests. *Applied Measurement in Education, 18*(2), 163–183.
- Wolfe, J. M. (1998). What can 1 million trials tell us about visual search? *Psychological Science, 9*(1), 33–39.
- Zhang, C., Gao, F., Jia, B., Zhu, Y., & Zhu, S.-C. (2019). RAVEN: A dataset for relational and analogical visual reasoning. *Proceedings of CVPR 2019*, 5312–5322.
