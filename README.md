# JVLN Intelligence

A multidimensional, adaptive assessment of how you think, by Javelin.

JVLN measures eleven cognitive domains with 37 instruments. Items are selected adaptively under item response theory. Every estimate comes with its uncertainty. Until the items are calibrated on a large sample, all ranks are **provisional and unnormed**, and no percentiles are shown.

> JVLN estimates performance on the measured constructs. It is not an IQ test, not a clinical instrument, and must not be used for decisions about a person.

## Run it

```bash
npm install
npm run dev          # development server
npm test             # unit, integration and simulation tests (Vitest)
npm run build        # typecheck and production build (static, host anywhere)
npm run e2e          # Playwright browser tests (set PW_CHROMIUM to a Chromium binary if needed)
```

## What is inside

| | |
|---|---|
| **Engine** (`src/engine`, `src/adaptive`) | UI-independent: 3PL model, EAP estimation, maximum-information selection with randomesque exposure control and content balancing, combined stopping rules, deterministic seeded sessions, idempotent submission, and resume that voids the open item |
| **Items** (`src/items`) | Generators with validity checks for matrices, series, deduction, analogies, balance, probability, spans, planning, games, belief tracking, artificial language, orientation, specimens and layout, plus five authored banks. Every item is validated with Zod before it is shown. |
| **Procedures** (`src/tasks`) | Reaction time, visual search, sustained attention, flanker, task switching, rule discovery, category learning with retention, reversal learning (Rescorla–Wagner fit), n-back, paired associates with delayed recall, dual task, typing, alternative uses and constrained writing |
| **Scoring** (`src/scoring`) | Facet, domain and general estimates; provisional S–F ranks with ranges; metacognition (bias, Brier decomposition, type-2 AUROC with bootstrap intervals); performance metrics with reliability caveats |
| **UI** (`src/pages`, `src/components`) | Landing, method, setup, runner, report, instrument library and internal item review. White / silver / graphite, dark mode, reduced motion, keyboard and touch |

## Documentation

| Document | Content |
|---|---|
| [RESEARCH.md](docs/RESEARCH.md) | The research basis, with citations |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Structure, data flow, data model |
| [PSYCHOMETRICS.md](docs/PSYCHOMETRICS.md) | Construct model and interpretation rules |
| [ADAPTIVE_TESTING.md](docs/ADAPTIVE_TESTING.md) | Estimation, selection, stopping, calibration path |
| [TASK_DESIGN.md](docs/TASK_DESIGN.md) | Every instrument, its difficulty model and validity checks |
| [SCORING.md](docs/SCORING.md) | Scores, ranks, metrics and the report |
| [LIMITATIONS.md](docs/LIMITATIONS.md) | What the results cannot tell you |
| [AUDIT.md](docs/AUDIT.md) | Psychometric, UX, accessibility and performance audits; break-it log |

## Privacy

No account and no personal data. Sessions are stored in the browser's local storage only. Fonts are self-hosted and no third-party requests are made. The report can export all data as JSON or delete it.
