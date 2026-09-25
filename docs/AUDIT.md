# Audits

Results of the psychometric, UX, accessibility and performance audits of JVLN Intelligence v1.0, and a log of what the "break it" pass found and fixed. Everything below can be reproduced with `npm test` and `npm run e2e`.

## 1. Psychometric audit

### Engine recovery (simulation)

`tests/battery.sim.test.ts` simulates participants who answer according to the 3PL model with the current provisional parameters, runs the full **Quick** battery for each (16 simulated people per θ), and compares the general estimate with the true θ:

| True θ | Bias | RMSE | Mean reported SE | Items |
|---|---|---|---|---|
| −1 | +0.01 | 0.27 | 0.22 | 49 |
| 0 | −0.03 | 0.18 | 0.21 | 49 |
| +1 | +0.04 | 0.18 | 0.21 | 48 |
| +2 | −0.05 | 0.17 | 0.22 | 49 |
| +3 | −0.07 | 0.20 | 0.24 | 49 |

**Interpretation.** Under a model-consistent simulation, selection, estimation and stopping recover ability across the whole intended range, including the upper tail, with reported SEs that match the empirical error.

**What this does not show.** It does **not** validate the parameters. If real items are harder or easier than predicted, estimates shift accordingly. Only empirical calibration can establish that (`RESEARCH.md` §16).

`tests/adaptive.test.ts` also checks the item-level CAT in isolation: bias stays below 0.25 at θ ≤ 1.5 and below 0.45 at θ = 3, which is the EAP shrinkage expected from Bock & Mislevy (1982).

### Construct and item checks

| Check | Result |
|---|---|
| Matrix answer sets solvable from the options alone? | No. A context-blind majority solver scores below 0.2 (chance is 0.125) over 1,650 items. |
| Uniqueness of generated answers | Series, deduction, analogy, balance, matrices, belief tracking, language, specimens, orientation, layout, tower and games each have independent test implementations that recompute the key. |
| Every key scores as correct, and every item validates | All levels and all bank items (`tests/generation.test.ts`). |
| Authored banks | 157 live items: unique slugs, keys spread across positions (no index > 26%), key rarely the longest option, ≥ 6 items with b ≥ 2 per core bank. |
| Rapid guessing | Excluded from θ, counted in the report, and unable to extend a section. |
| Memory control in belief tracking | Wrong control answer → the belief item is excluded from θ and reported. |

### Ceilings and floors by instrument

| Instrument | Hardest available b | Limiting factor |
|---|---|---|
| Matrix inference | 3.7 | Could extend with more components |
| Sequence induction | 3.7 | — |
| Relational deduction | 3.6 | — |
| Transformation analogies | 3.5 | — |
| Balance systems | 3.4 | — |
| Probabilistic reasoning | 3.4 | — |
| Spatial sequence | 3.2 (10 positions) | Nine blocks; length 10 revisits blocks |
| Verbal manipulation | 3.0 | Reverse order up to 9 characters; sorting variant up to 8 |
| Planning (tower) | 3.7 | The 4-ball state space tops out at 9 moves; level 9 has only 24 distinct problems |
| Backward induction | 3.6 | — |
| Belief tracking | 3.6 | Fifth-order beliefs, near the human limit |
| Artificial language | 3.5 | — |
| Orientation | 3.0 | — |
| Specimen anomaly | 3.3 | — |
| Authored banks | 2.4–3.4 | Few items above b = 3; upper-tail precision is limited |

A participant who solves the hardest level of an instrument gets a **ceiling** flag and an "or higher" rank range, not an invented number.

### Open psychometric risks

1. **Provisional parameters are the main risk.** Difficulty models were set from the literature and item structure, not from response data.
2. **Learning** rests on four problem outcomes, so its SE is large (about 0.8 in simulation). The report shows this.
3. **The general estimate is unidimensional.** A bifactor model, fitted once data exist, may re-weight domains.
4. **Authored social, strategic and language items** need empirical review. Item writers can misjudge difficulty and can miss alternative defensible answers.

## 2. UX audit

| Area | Finding | Action |
|---|---|---|
| Orientation | The runner header always shows section n / N, the domain, the instrument and the item number. | — |
| Transitions | 180 ms crossfade between steps; intro numbers and report use restrained spring and fade motion. | Reduced-motion users get no motion (MotionConfig `reducedMotion="user"`). |
| Matrix layout | Options fell below the fold at 900 px height. | Side-by-side layout from 1,100 px width. |
| Practice feedback | The matrix explanation used internal rule codes. | Rewritten in plain language. |
| Long sessions | Full takes 100–130 min. | Pause at any time, and resume after closing the tab. Pausing replaces the open item. |
| Confidence probe | Must be set explicitly, so there is no default anchoring. | — |
| Errors | A failed chunk load or render error now shows a recoverable message instead of a blank page. | ErrorBoundary around pages and renderers. |

## 3. Accessibility audit

- **axe-core (WCAG 2 A/AA)** runs in `e2e/a11y.spec.ts` on landing, method, setup, library and item review in **light and dark**, and on the runner intro and a live item. It reports **no serious or critical violations**.
- Fixed during the audit:
  - Muted and faint text tokens were below 4.5:1 contrast. Both are now darkened in light mode and lightened in dark mode.
  - Image-only answer options had no accessible name. They are now labelled "Option n".
- Keyboard:
  - Every item accepts digits for options, Enter to submit, arrow keys for the confidence slider and orientation dial, and Space, F/J or D/F/J/K for timed tasks.
  - `e2e/app.spec.ts` checks keyboard-only answering.
- Screen readers:
  - Figures carry text alternatives: matrix grid description, tower peg contents, specimen traits, balance equations, belief stories as text.
  - Timed perceptual tasks (reaction, search, SART) cannot be made equivalent for screen-reader users. That is inherent to the paradigms and is stated here.
- Touch:
  - All tasks work with touch: on-screen keypad and tap pads.
  - Mobile RTs are labelled as not comparable.

## 4. Performance audit

| Measure | Result |
|---|---|
| Landing JS | ~355 kB (React, Motion, shell). The engine and all item banks (~225 kB) load only on pages that need them. |
| Task renderers | Code-split per instrument. |
| Item generation | Every level of every instrument takes < 20 ms per item (`tests/generation.test.ts` fails above 250 ms). The slowest are specimens (~17 ms) and belief stories (~7 ms). |
| Timed stimuli | Written directly to the DOM. Onsets use the frame after paint, responses use `event.timeStamp`, and React does not re-render during a trial. |

## 5. Break-it log

Found by deliberately abusing the app, then fixed and covered by a test:

| Attack | Failure found | Fix |
|---|---|---|
| Rapid guessing through a section | A section never ended: rapid guesses are excluded from θ, so the length cap was never reached. The e2e run showed "Item 392". | The cap counts all administered items (`tests/session.test.ts` → *guessing participants*). |
| Very high ability on spatial span | Level 10 asked for 10 distinct blocks out of 9, an **infinite loop** that would freeze the tab. | Sequences longer than 9 revisit blocks, never twice in a row (`tests/generation.test.ts`). |
| Easy levels with tiny pools (games L1) | The same instance could appear twice in a section, and the review page collided on React keys. | Repeats are regenerated; keys include the index. |
| Double and triple Enter | — (already idempotent) | Covered by e2e *double submission counts once*. |
| Reload mid-item | — | The item is voided and a new one issued (e2e). |
| Back button during a test | — | Leaves the runner; the session resumes from Setup (e2e). |
| Corrupted or foreign localStorage | — | Validated on read; the app shows empty states (unit and e2e). |
| Storage unavailable (private mode) | — | Warning banner; the session continues in memory (unit test). |
| Malformed procedure result | — | Rejected by Zod and logged; the session stays active (unit test). |
| Malformed generated item | — | Zod validation before issue; regenerated or the section closes (`tests/generation.test.ts`). |
| Chunk load failure | Blank page | ErrorBoundary with reload. |

### Known remaining issues

- `npm run e2e` needs a Chromium matching Playwright 1.56. In this environment, set `PW_CHROMIUM` to the pre-installed browser.
- Timing tasks rely on `setTimeout` for stimulus durations. Actual display durations can deviate by one frame (about 17 ms at 60 Hz).
- No server: exposure control, norms and online calibration are designed (`src/data/schema.sql`) but not active.
