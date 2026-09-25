# Task Design

Specifications for every JVLN instrument. Each entry lists the construct, the format, how difficulty scales, the validity checks the generator runs, and how the task is scored. Research references are in `RESEARCH.md`.

## Shared rules

- **Practice first.** Every unfamiliar paradigm starts with 1–3 practice items. They give feedback and are never scored.
- **No feedback during measurement.** The only exceptions are paradigms where feedback *is* the task: rule discovery, category learning and reversal learning.
- **Constructed responses where possible.** Typing a number, a string or a move count removes guessing (c = 0) and elimination strategies.
- **Time limits** are generous on power tests. They only prevent a session from stalling, not create speed pressure. A timeout scores as incorrect.
- **Minimum plausible time.** Every paradigm defines one. Faster responses are flagged as rapid guesses (Wise & Kong, 2005) and excluded from θ.
- **Keyboard parity.** Every response can be given with a keyboard: digits for options, Enter to submit, arrow keys for sliders and dials.
- **Seeded generation.** An item is fully determined by `(paradigm, level, seed)`.
- **Difficulty bands.** Each level carries a provisional (a, b, c) and a band: Foundation, Standard, Advanced, Elite or Apex (see `ADAPTIVE_TESTING.md`).

---

## 01 Reasoning

### Matrix inference · `matrix`
**Construct:** fluid inductive reasoning (Gf).
**Format:** 3×3 matrix with the last cell missing. Eight answer options, which gives c = 1/8.

**Structure**
- **Layouts:**
  - *single* — one entity per panel
  - *grid* — up to 9 entities in a 3×3 sub-grid
  - *dual* — two independent components, left and right, each with its own rule set
- **Entity attributes:** shape (5), size (5), shade (5 greys), rotation (4 angles), count or position.
- **Rules**, applied row-wise and listed roughly from easiest to hardest:
  - *constant*
  - *progression* (±1 or ±2 steps)
  - *distribution of three* (each row a permutation of the same three values)
  - *arithmetic* (col 3 = col 1 ± col 2, on count or size)
  - *set operations on positions* (col 3 = col 1 XOR col 2, or OR, or AND)

**Levels**

| L | Layout | Rules (non-constant) | b |
|---|---|---|---|
| 1 | single | 1 progression | −1.6 |
| 2 | single | 2 (progression, distribution) | −0.9 |
| 3 | single | 2 incl. rotation | −0.4 |
| 4 | single | 3 | 0.2 |
| 5 | grid | count progression + shape distribution | 0.7 |
| 6 | single | 3 incl. arithmetic | 1.2 |
| 7 | grid | position XOR + shade distribution + size | 1.7 |
| 8 | dual | 2 + 2 | 2.2 |
| 9 | dual | 3 + 2 incl. arithmetic | 2.7 |
| 10 | dual | 3 + 3 incl. set operation | 3.2 |
| 11 | dual | 4 + 3 incl. arithmetic and set operation | 3.7 |

**Validity checks**
- *Uniqueness:* for every attribute, every rule in the library that fits rows 1–2 and the first two cells of row 3 must predict the same missing value. Otherwise the item is regenerated.
- *Balanced answer set* (I-RAVEN style): choose three attributes, each with one alternative value, and build all 2³ combinations. Each attribute value then appears in exactly four of eight options.
- *Context-blind test:* a solver that only sees the options and picks the modal value per attribute must stay near 1/8 accuracy (unit test over 2,000 items).
- *Visual distinctness:* alternative values must differ by at least 2 steps on graded attributes.

**Scoring:** dichotomous. Minimum plausible time: 3 s.

### Sequence induction · `series`
**Construct:** inductive and quantitative reasoning.
**Format:** 5–7 terms of a number sequence, then type the next term. Constructed response, c = 0.

**Rule families by level**

| L | Rule | Example structure | b |
|---|---|---|---|
| 1 | arithmetic | +k | −1.8 |
| 2 | geometric | ×k | −1.1 |
| 3 | second-order differences | Δ grows by k | −0.4 |
| 4 | interleaved arithmetic | two alternating series | 0.2 |
| 5 | additive recurrence | aₙ = aₙ₋₁ + aₙ₋₂ | 0.6 |
| 6 | operation cycle | +p, ×q, +p, ×q … | 1.0 |
| 7 | affine recurrence | aₙ = k·aₙ₋₁ + m | 1.5 |
| 8 | position-dependent | aₙ = aₙ₋₁ + n² or aₙ = aₙ₋₁·n − m | 2.0 |
| 9 | differences form a geometric series | Δₙ = Δₙ₋₁·k | 2.3 |
| 10 | interleaved second-order | two alternating series, each with growing Δ | 2.8 |
| 11 | third-order recurrence | aₙ = aₙ₋₁ + aₙ₋₂ − aₙ₋₃ + k, or tribonacci-type | 3.3 |
| 12 | nested | differences follow an operation cycle | 3.7 |

**Validity checks**
- *Ambiguity:* every family in the library that is at most as complex is fitted to the shown terms. If any fits exactly but predicts a different next term, the item is rejected.
- *Magnitude:* all terms are integers with |term| < 10,000.

**Scoring:** exact integer match. Minimum plausible time: 2 s.

### Relational deduction · `deduction`
**Construct:** deductive reasoning with premise integration.
**Format:** premises about nonsense-named entities ("Vell is taller than Oskar") and one question. There are two question types:
- "Which statement must be true?"
- "How many positions could X occupy?"

The first type has 4–5 options, including **"Cannot be determined"** where relevant.

**Difficulty features:** number of terms (3–7), premises out of chain order, inverted relation words, negations, indeterminacy (several orderings consistent), two dimensions, and the integration distance of the target inference.

| L | Terms | Features | b |
|---|---|---|---|
| 1 | 3 | chain order, one relation word | −1.6 |
| 2 | 4 | shuffled premises, mixed relation words | −0.7 |
| 3 | 5 | shuffled, target 3 steps away | 0.1 |
| 4 | 5 | indeterminate; distractors that are possible but not necessary | 0.9 |
| 5 | 6 | negations, indeterminate | 1.6 |
| 6 | 6 | two dimensions (left/right, front/back) | 2.3 |
| 7 | 7 | indeterminate, negations, counting question | 3.0 |
| 8 | 7 | two dimensions, indeterminate, counting question | 3.6 |

**Validity checks:** the truth of every option is computed by enumerating **all** orderings consistent with the premises (7! = 5,040 at most). Exactly one option must be necessarily true.

**Scoring:** dichotomous. Minimum plausible time: 4 s.

### Transformation analogies · `analogy`
**Construct:** analogical and inductive reasoning.
**Format:** `A → B` then `C → ?`, where A, B and C are strings of letters. The answer is typed.

**Operations:** reverse, rotate left or right, shift every letter by ±k, swap first and last, sort, duplicate the last letter, drop the first letter, mirror (append the reverse), and conditional shifts (vowels only, or positions at even indices).

| L | Operations composed | Examples shown | b |
|---|---|---|---|
| 1 | 1 | 1 | −1.4 |
| 2 | 1 (harder operation) | 1 | −0.6 |
| 3 | 2 | 2 | 0.2 |
| 4 | 2 | 1 | 0.9 |
| 5 | 3 | 2 | 1.6 |
| 6 | 3 incl. conditional | 2 | 2.3 |
| 7 | 3 | 1 | 2.9 |
| 8 | 4 incl. conditional | 2 | 3.5 |

**Validity check:** exhaustive search over all compositions of up to 4 operations. Every *minimal* composition consistent with the examples must produce the same output for C. Otherwise the item is regenerated. The strings avoid wrap-around ambiguity (no letter shifts past `z`).

**Scoring:** exact string match, case-insensitive. Minimum plausible time: 3 s.

## 02 Quantitative & Probabilistic

### Balance systems · `balance`
**Construct:** quantitative relational reasoning.
**Format:** 1–4 balanced scales with abstract symbols (◯ △ □ ⬡). Question: "How many ◯ balance one △?" The answer is a typed number.

| L | Unknowns | Scales | Features | b |
|---|---|---|---|---|
| 1 | 2 | 1 | direct reading | −1.6 |
| 2 | 2 | 2 | one substitution | −0.8 |
| 3 | 3 | 2 | chain substitution | 0.0 |
| 4 | 3 | 3 | mixed pans (symbols on both sides) | 0.8 |
| 5 | 3 | 3 | elimination required | 1.5 |
| 6 | 4 | 3 | elimination, answer is a multiple | 2.2 |
| 7 | 4 | 4 | mixed pans and elimination | 2.9 |
| 8 | 4 | 4 | the question asks about a composite (e.g., "2△ + ◯ balance how many □?") | 3.4 |

**Validity checks:** the system has a unique positive integer solution, verified by Gaussian elimination on rationals. The answer is an integer between 1 and 60.

**Scoring:** exact match. Minimum plausible time: 3 s.

### Probabilistic reasoning · `probability`
**Construct:** reasoning under uncertainty.
**Format:** a short scenario with five options. The distractors encode known errors: base-rate neglect, the inverse conditional, adding instead of multiplying, ignoring replacement, and the naive average in Simpson's paradox.

| L | Type | b |
|---|---|---|
| 1 | single event (urn, die) | −1.4 |
| 2 | complement / at least one | −0.6 |
| 3 | conditional probability from natural frequencies | 0.0 |
| 4 | expected value comparison, three outcomes | 0.6 |
| 5 | sampling without replacement | 1.1 |
| 6 | Bayes, probability format | 1.7 |
| 7 | Simpson's paradox (aggregated vs stratified rates) | 2.3 |
| 8 | sequential Bayesian updating (two tests) | 2.9 |
| 9 | conditional on a derived event with dependent draws | 3.4 |

**Validity checks:** answers are computed exactly with rational arithmetic and shown as percentages rounded to one decimal. Distractors must differ from the key and from each other by at least 2 percentage points.

**Scoring:** dichotomous. Minimum plausible time: 4 s.

## 03 Memory

### Spatial span · `spatialSpan`
**Construct:** visuospatial working memory.
**Format:** nine blocks in an irregular layout light up one at a time (700 ms on, 250 ms off). The user reproduces the sequence. The *Full* battery adds backward trials.

**Levels:** the sequence length is the level, from 3 to 10. The provisional difficulty is b(L) = 0.8 × (L − 6). Kessels et al. (2008) found backward Corsi is not harder than forward, so backward trials use the same difficulty.

**Scoring:** the whole sequence must be correct. Each trial is an IRT item.

### Verbal manipulation span · `verbalSpan`
**Construct:** verbal working memory with manipulation.
**Format:** consonants appear one at a time (900 ms). The user types them **in reverse order**. From level 7, the sequence mixes letters and digits and must be typed *digits ascending, then letters alphabetically*, which adds manipulation under load.

**Levels:** b(L) = 0.8 × (L − 5.2) for reverse order, plus 0.6 for the sorting variant.

**Scoring:** exact sequence match. Letters are phonologically distinct (no B/D/P/T/V clusters).

### N-back · `nback` *(performance)*
2-back and 3-back blocks of 30 trials each, with n−1 and n+1 lures (Kane et al., 2007). Reports hits, false alarms, lure false alarms and d′. It is not ranked, because of its low reliability (Jaeggi et al., 2010).

### Paired associates with delayed recall · `pairsEncode` / `pairsRecall`
Encoding happens early in the session: 8 glyph–word pairs with two study rounds, then immediate cued recall (8-option choice). **Delayed cued recall** comes at the end of the session, at least 15 minutes later. Reports immediate and delayed accuracy, the retention ratio and the delay in minutes.

## 04 Attention & Processing *(performance)*

### Reaction · `reaction`
Simple reaction time (20 trials) and 4-choice reaction time (40 trials), with foreperiods of 800–2,200 ms. Reports median RT, the RT coefficient of variation, anticipations, errors and inverse efficiency. The input type is stored, and RTs are never compared across input types.

### Visual search · `search`
Find a T among L's. Set sizes 4, 8, 16 and 24; target present on 50% of trials; 80 trials. Reports search slopes (ms/item) for present and absent trials from regression on correct trials, the intercept and accuracy.

### Sustained attention · `sart`
Digits 1–9, 225 trials at 1,150 ms SOA. Respond to every digit except 3. Reports commission and omission errors, RT variability and the speeding in the four trials before an error (Robertson et al., 1997).

## 05 Executive Function

### Planning · `tower`
**Construct:** planning (look-ahead search).
**Format:** a one-touch Tower of London. Three pegs hold 3, 2 and 1 balls in the classic version and 4, 3, 2 and 1 in the extended one. A start and a goal configuration are shown, and the user answers **"What is the minimum number of moves?"** by choosing 1–12.

**Features:** minimum moves (from breadth-first search over the full state space), **search depth** (optimal moves that do not place a ball in its final position), and goal hierarchy (whether the goal order is visually ambiguous).

| L | Balls | Min moves | Detour moves | b |
|---|---|---|---|---|
| 1 | 3 | 2 | 0 | −1.6 |
| 2 | 3 | 3 | 0 | −1.0 |
| 3 | 3 | 4 | ≥1 | −0.3 |
| 4 | 3 | 5 | ≥1 | 0.4 |
| 5 | 3 | 6–7 | ≥2 | 1.1 |
| 6 | 4 | 6–7 | ≥2 | 1.8 |
| 7 | 4 | 8–9 | ≥3 | 2.5 |
| 8 | 4 | 10–11 | ≥3 | 3.2 |
| 9 | 4 | 12+ | ≥4 | 3.7 |

**Scoring:** exact. Twelve options give c ≈ 1/12, but in practice c is 0 for random picks near the key because options far from it are implausible. c is set to 0.05.

### Task switching · `switching` *(performance)*
Digits 1–9 excluding 5. The task is parity or magnitude, cued by the shape of the frame, with a cue–target interval of 400 ms. Blocks: 20 parity, 20 magnitude, then 64 mixed. Reports the switch cost and mixing cost (RT and errors) plus the **bin score** (Draheim et al., 2016), with a reliability caveat.

### Interference · `flanker` *(performance)*
Arrow flanker with 50% incongruent trials, 96 trials. Reports the RT and error interference effect, and the inverse-efficiency difference.

### Rule discovery · `rules`
Card sorting with a hidden rule (colour, shape or count) that changes without warning after 6 consecutive correct sorts, over up to 60 cards. Every card is unambiguous. Reports rules found, perseverative errors, trials to the first rule and post-error accuracy. These are process metrics, not IRT.

## 06 Learning

### Hidden-rule category learning · `category`
**Construct:** rule acquisition and generalisation.
**Format:** a sequence of problems. Each problem shows creatures built from four binary features, one of which is irrelevant. The user classifies each creature into one of two groups and gets feedback. Learning continues until two consecutive perfect blocks of 8, or at most 6 blocks. A **transfer test** then shows 8 creatures that were held out of training, without feedback.

**Problem types** (Shepard et al., 1961; extended):

| Problem | Structure | b |
|---|---|---|
| 1 | Type I (one feature) | −1.5 |
| 2 | Type II (XOR of two features) | 0.2 |
| 3 | Type IV (family resemblance) | 0.6 |
| 4 | Type VI (three-way parity) | 2.0 |

**Scoring:** a problem counts as correct when the user reaches criterion and scores ≥ 7/8 on transfer. Each problem is an IRT item. Also reported: errors to criterion, the learning curve and transfer accuracy. **Retention:** Problem 1 is re-tested without feedback at the end of the session.

### Reversal learning · `reversal` *(performance)*
Three options with reward probabilities of .80, .50 and .20. The best option changes every 25–35 trials, over 160 trials. Reports accuracy, trials to adapt after each reversal, win-stay and lose-shift, and a fitted Rescorla–Wagner learning rate α and inverse temperature β (maximum likelihood on a grid).

## 07 Strategic

### Backward induction · `games`
**Construct:** strategic look-ahead in two-player games.
**Format:** a subtraction game. Two players take turns removing a number of tokens from an allowed set, and whoever takes the last token wins. Question: "Which move guarantees a win?" The options are the allowed moves plus "No move guarantees a win."

| L | Heaps | Move set | Rule | Heap size | b |
|---|---|---|---|---|---|
| 1 | 1 | {1, 2} | normal | 4–6 | −1.4 |
| 2 | 1 | {1, 2, 3} | normal | 7–11 | −0.6 |
| 3 | 1 | irregular, e.g. {1, 3, 4} | normal | 8–14 | 0.3 |
| 4 | 1 | irregular | normal | 15–24 | 1.0 |
| 5 | 1 | irregular | **misère** (last token loses) | 10–18 | 1.7 |
| 6 | 2 | {1, 2, 3} | normal | small heaps | 2.4 |
| 7 | 2 | irregular | normal | small heaps | 3.0 |
| 8 | 2 | irregular | misère | small heaps | 3.6 |

**Validity checks:** positions are solved exactly by dynamic programming, using Sprague–Grundy values for two heaps under normal play and direct search for misère. Only positions with exactly one winning move or none are used.

**Scoring:** dichotomous. Minimum plausible time: 3 s.

### Strategic scenarios · `strategic`
An authored bank of situations where the best choice follows from stated incentives: auctions, commitment, signalling, coordination, iterated dominance and hold-up. Writing avoids game-theory vocabulary, and each item has one keyed answer with a written rationale.

## 08 Metacognition *(embedded layer)*

On a seeded subset of items (50% in Core, 100% of matrix, series and deduction items in Full), the user rates confidence right after answering: "How likely is it that your answer is correct?", from 0 to 100% in steps of 5. The rating must be set explicitly before continuing. Reports:

- mean confidence
- accuracy
- bias (over- or underconfidence)
- Brier score with its calibration and resolution components
- type-2 AUROC with a bootstrap 90% interval
- the number of rated items

## 09 Social Cognition

### Recursive belief tracking · `beliefs`
**Construct:** representing nested mental states (theory of mind), with a memory control.
**Format:** a short generated story. Agents move an object between containers while others are present, absent or watching secretly. The question asks for a nested belief, for example "Where does Mara think Ilse thinks the key is?" Options are the containers, so c = 1/k.

**Belief model:** a move enters the belief of chain [c₁, …, cₙ] only if c₁ saw it (openly or secretly) and every later agent in the chain was *openly* present. The answer is the object's location after the last move that entered the chain's belief.

**Memory control:** after each story, a factual question such as "Where is the key now?" or "Who saw the second move?" If it is answered wrongly, the belief item is flagged as possibly memory-limited and excluded from θ.

| L | Order | Agents | Moves | Secret observer | b |
|---|---|---|---|---|---|
| 1 | 1 | 2 | 1 | no | −1.8 |
| 2 | 2 | 3 | 2 | no | −0.8 |
| 3 | 2 | 3 | 3 | yes | 0.0 |
| 4 | 3 | 3 | 3 | no | 0.7 |
| 5 | 3 | 4 | 4 | yes | 1.4 |
| 6 | 4 | 4 | 4 | yes | 2.2 |
| 7 | 5 | 4 | 5 | yes | 3.0 |
| 8 | 5 | 5 | 6 | yes, twice | 3.6 |

**Validity checks:** the answer location must differ from the object's true final location for orders ≥ 2, and from the answer at order − 1, so that level-skipping strategies fail. Every container in the options was visited at least once.

### Social inference · `social`
An authored bank of scenarios on intent, deception, manipulation, incentive recognition, coalition dynamics and emotion understanding. Every item has one defensible keyed answer and a written rationale, and passes the review checklist below.

## 10 Language

### Artificial language · `language` *(reasoning)*
**Construct:** linguistic pattern induction.
**Format:** 4–6 example sentences in an invented language with English glosses. The user chooses the correct translation of a new English sentence from 8 options. The options are built as a balanced 2×2×2 design over three grammatical features.

**Rules:** word order (SVO or SOV), a plural suffix, a negation prefix, past-tense marking, subject agreement, question inversion, and a possessive construction.

| L | Rules to infer | b |
|---|---|---|
| 1 | 1 | −1.2 |
| 2 | 2 | −0.4 |
| 3 | 3 | 0.4 |
| 4 | 3 with agreement | 1.2 |
| 5 | 4 | 2.0 |
| 6 | 4 with question inversion | 2.8 |
| 7 | 5 incl. possessive recursion | 3.5 |

### Semantic relations · `semantic` *(knowledge)*
An authored bank of analogies and relations with graded vocabulary. Tagged `load: 'knowledge'`.

### Precise reading · `reading` *(reasoning)*
An authored bank of instructions, policies and statements with quantifier and scope subtleties. Question: "Which is permitted, required or implied?"

## 11 Adaptive / Natural *(experimental)*

### Orientation · `orientation`
**Construct:** spatial orientation and perspective taking.
**Format:** a map with 5–7 landmarks. "You stand at *A*, facing *B*. In which direction is *C*?" The answer is picked on an 8-direction dial (front, front-right, right …), so c = 1/8.

**Features:** the angular offset between the facing direction and map-north (0°–180°), the number of landmarks, and whether the map is hidden once the question appears (memory).

| L | Facing offset | Map | b |
|---|---|---|---|
| 1 | 0° | visible | −1.6 |
| 2 | 90° | visible | −0.6 |
| 3 | 135–180° | visible | 0.4 |
| 4 | oblique, 7 landmarks | visible | 1.1 |
| 5 | oblique | hidden after 8 s | 2.0 |
| 6 | oblique, relative question ("…where would B be if you turned to face C?") | hidden | 3.0 |

**Validity:** the target direction must lie at least 12° away from any sector boundary, so rounding never decides correctness.

### Specimen anomaly · `specimens`
**Construct:** detecting covariation structure in natural-looking patterns.
**Format:** nine generated organisms. Their traits (segments, limb pairs, symmetry, markings, antennae) follow a hidden covariation rule. One specimen violates it; find it (c = 1/9).

| L | Rule | Noise traits | b |
|---|---|---|---|
| 1 | one constant trait | 0 | −1.5 |
| 2 | one constant trait | 2 | −0.7 |
| 3 | two traits covary (A ⇒ B) | 1 | 0.2 |
| 4 | numeric relation (limbs = 2 × segments) | 2 | 1.0 |
| 5 | conjunction (A ∧ B ⇒ C) | 2 | 1.8 |
| 6 | two independent covariation rules; the anomaly breaks one | 2 | 2.6 |
| 7 | parity or modular relation across two traits | 3 | 3.3 |

**Validity:** exactly one specimen violates the rule set, and every other specimen satisfies it. The anomaly must not be unique on any single trait unless that trait is part of the rule.

## Applied and performance modules (separate from the core composite)

| Module | Scored |
|---|---|
| `dualTask` | Shape discrimination alone, a running count of red flashes alone, then both together. Reports dual-task costs (proportional pDTC) for RT, accuracy and count error. |
| `typing` | 60 s of copy typing. Reports gross and net WPM, accuracy and the corrected-error rate. |
| `rat` | Compound remote associates, 30 s each, typed answers. Items are ordered by difficulty; b is provisional. |
| `uses` | Alternative uses, two objects, 90 s each. Reports fluency (valid, non-duplicate responses). Originality and flexibility show as *Calibration required*. |
| `constrained` | Short writing under explicit constraints. Constraint adherence is checked algorithmically. |
| `prompting` | Authored applied items: ambiguity, constraints, decomposition, context, prompt debugging, output evaluation, delegation. |
| `layout` | Generated interface layouts. Find the element whose alignment or spacing breaks the system; difficulty is the offset in px. |

## Authored item review checklist

An authored item enters a bank only if a reviewer can answer **yes** to all of these:

1. Is there exactly one defensible answer, and is it keyed?
2. Is the rationale written down?
3. Can the item be answered without irrelevant knowledge (for non-knowledge facets)?
4. Is there no surface clue: option length, grammatical agreement, or overlap in wording with the stem?
5. Are the distractors plausible to someone who misreads, and wrong to someone who reads carefully?
6. Is it free of cultural traps, or are those deliberate and documented?
7. Is it readable in under 60 seconds?
8. Is it original rather than copied from a published test?

The item schema stores `reviewed: boolean`. Unreviewed items are excluded from administration.

## Implementation notes (v1.0)

Where the implementation deviates from the tables above, the implementation is authoritative. Each deviation was made to keep items valid and unambiguous.

- **Planning (tower).** The 3-ball state space has a maximum of 8 minimum moves and the 4-ball space a maximum of 9. Levels 7–9 are therefore defined by detours instead: L7 is 7 moves with ≥3 detours, L8 is 8 with ≥4, and L9 is 9 with ≥5 (only 24 distinct problems exist). The answer is typed (1–20), so c = 0.
- **Backward induction.**
  - With {1,2,3} and two heaps, won positions almost always have two winning moves. Two-heap levels therefore use irregular sets such as {1,3,4}, {2,3,5}, {1,2,6} and {1,4,6}.
  - Normal play is defined as "whoever cannot move loses". Misère move sets always contain 1.
  - About 25% of positions are losing, and the key is then "No move guarantees a win".
- **Spatial sequence.** Nine blocks, so a 10-position sequence revisits blocks, never twice in a row.
- **Balance systems.**
  - Scales must determine every weight, not only the asked ratio.
  - Answers run from 2 to 60.
  - "Elimination" levels cannot be solved by repeatedly using a scale with a single unknown.
- **Probabilistic reasoning.**
  - The expected-value level keeps only items where the naive average points the wrong way.
  - Simpson items show a reversal in about 70% of cases, so "paradox" is not always the answer.
- **Belief tracking.**
  - 3 containers at L1–L2 and 4 from L3.
  - One option may be a container the object never visited, which keeps L1 from having only two options.
  - Every secret watch changes the answer.
  - The story stays visible during the question, so the control question is a comprehension and attention check rather than a pure memory test.
- **Artificial language.**
  - Wrong options are plausible misapplications of a rule (English word order, a suffix on the wrong noun, agreement with the object), not simple omissions.
  - L7 tests a double possessive after showing only single ones.
- **Orientation.**
  - From L2, the key never equals the map-relative direction, so answering without rotating fails.
  - The collinearity rule is waived for front and back keys, because the 12° margin already enforces separation.
- **Specimen anomaly.**
  - L1 and L2 carry 2 and 3 noise traits, so the eight regular specimens are distinct.
  - The numeric rule is limb pairs = segments + k.
  - No simpler rule may single out a different specimen.
- **Layout precision.** Offsets are 12, 10, 6, 4, 3 and 2 px. 8 px is avoided so that exactly one element is off the 8-px grid.
- **Authored banks.** 157 live items: social 37, strategic 28, semantic 36, reading 27, prompting 28. Each bank also has two practice items.
