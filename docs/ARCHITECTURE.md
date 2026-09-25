# Architecture

JVLN Intelligence is a single-page web application. It has a UI-independent assessment engine at the core and a React interface on top. This document covers the structure, the data flow and the main decisions.

## Principles

1. **The engine knows nothing about React.** Sessions, item generation, scoring, adaptivity and reports are plain TypeScript with no DOM access. They run in unit tests, in simulations and in the browser identically.
2. **Sessions are data.** A session is a serialisable object. Every engine function takes a session and an action and returns the next session. That makes persistence, recovery, auditing and testing straightforward.
3. **Determinism.** All randomness comes from a seeded PRNG derived from the session seed and the step index. Any item can be regenerated, and a crashed session can be rebuilt.
4. **Idempotent submission.** Every item is issued with a `stepId`. A response for a stale or already-answered step is ignored and logged. Double clicks and replays cannot double-count.
5. **Measurement before motion.** Timed stimuli are drawn with direct DOM or canvas writes inside refs, outside React's render cycle. Animations never run on a stimulus while it is being timed.
6. **No fake features.** Anything that needs data or services JVLN does not have yet (norms, backend sync, AI scoring) is either absent or clearly marked *Provisional*, *Calibration required* or *Not scored*.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Type-safe item and session schemas |
| UI | React 19 | Component model for many task renderers |
| Build | Vite | Fast dev server, static output that runs on any host |
| Motion | `motion` (Framer Motion) | Spring transitions, layout animation, reduced-motion support |
| Validation | Zod | Runtime validation of items, stored sessions and imports |
| Fonts | Geist and Geist Mono, self-hosted via Fontsource | No third-party font requests (see `RESEARCH.md` §13) |
| Styling | CSS custom-property design tokens plus component CSS | Full control, zero runtime cost. This replaces Tailwind. |
| Unit and integration tests | Vitest | Runs the engine in Node |
| Browser tests | Playwright | Desktop, mobile, keyboard and resilience flows |
| Persistence | `localStorage` repository behind an interface | Works offline. A Postgres schema for server persistence is in `src/data/schema.sql`. |

## Directory layout

```
src/
  types/        Shared types: items, responses, sessions, reports
  utils/        Seeded RNG, maths (normal CDF/quantile), statistics
  adaptive/     IRT model, EAP estimation, item selection, stopping rules
  items/        Item schema (Zod), paradigm registry, item validation
    generators/ Rule-based generators with complexity → difficulty models
    banks/      Authored item banks (social, strategic, language, applied)
  tasks/        Procedure paradigms: trial schedules and scoring for performance tasks
  engine/       Batteries (Quick/Core/Full), session state machine, integrity
  scoring/      Ranks, domain aggregation, metacognition, performance metrics, report
  analytics/    Local event log
  data/         Storage repository, SQL schema
  design/       Tokens, base styles, motion presets
  components/   UI primitives and task renderers
  pages/        Landing, Method, Setup, Assessment, Report, Library, Item Review
  app/          App shell and router
docs/           Research and specifications
tests/          Vitest unit, simulation and integration tests
e2e/            Playwright browser tests
```

## Two kinds of paradigm

| | Item paradigm | Procedure paradigm |
|---|---|---|
| Examples | Matrices, series, deduction, belief tracking, spans, planning | Reaction time, flanker, task switching, sustained attention, reversal learning |
| Unit of administration | One item at a time, chosen adaptively | A block of trials run by the renderer |
| Engine role | Generates or selects each item, scores it, updates θ, decides when to stop | Builds a deterministic trial schedule and scores the returned trial log |
| Output | θ, SE, interval, item log | Metrics (RT, d′, costs, learning parameters), optionally scored item outcomes |

Item paradigms feed the IRT estimates. Procedure paradigms produce performance metrics, which are **not** converted into ranks without norms (see `SCORING.md`).

## Engine API

```ts
createSession(options): Session
getStep(session): Step                        // what the UI should show now
dispatch(session, action): Session            // begin, respond, finish procedure, pause …
resumeSession(stored): Session                // voids an item that was open during a reload
generateReport(session): Report
```

`Step` is a discriminated union:

```
section-intro → practice (0..n) → item (1..n) → section-outro
section-intro → practice → procedure → section-outro
complete
```

The UI renders the step and dispatches an action. The engine validates the action against the current `stepId`, applies it, persists the session and returns the new state.

### Session lifecycle

```
createSession ─▶ plan sections from the battery
     │
     ▼
 section-intro ──begin──▶ practice items (feedback, not scored)
                                 │
                                 ▼
                     ┌──── adaptive loop ────┐
                     │ select level/item     │
                     │ issue step (stepId)   │
                     │ receive response      │
                     │ score, flag, update θ │
                     │ stop? ───────────────┼──▶ section-outro ──▶ next section
                     └───────────────────────┘
                                                   … ──▶ complete ──▶ report
```

### Recovery

The session is written to storage after every dispatch. On reload:

- An item that was on screen during the reload is **voided**. It is recorded as an interruption, not as a response, and a fresh item is selected. Showing the same item again would give extra exposure time.
- An interrupted procedure block restarts from its beginning.
- The session keeps an `events` log of pauses, resumes, visibility changes and voided steps. The report summarises these under *Test conditions*.

## Item model

```ts
interface Item<C> {
  id: string              // stable, versioned: "matrix:v1:L7:3f9a…"
  version: number
  paradigm: ParadigmId
  domain: DomainId
  facet: FacetId
  level: number
  band: 'foundation' | 'standard' | 'advanced' | 'elite' | 'apex'
  irt: { a: number; b: number; c: number; calibration: 'provisional' | 'calibrated' }
  timeLimitMs: number
  response: ResponseSpec  // choice | number | text | sequence | direction …
  content: C              // paradigm-specific payload
  key: unknown            // correct answer (never sent to UI components that don't need it)
  features: Record<string, number | string>   // complexity features that predicted b
  explanation?: string    // shown only in Item Review
  source: { kind: 'generated'; generator: string; seed: number } | { kind: 'authored'; author: string; reviewed: boolean }
}
```

Every item passes `validateItem()` before it can be administered. Generators run their own paradigm-specific checks for ambiguity, uniqueness and answer-set balance. The **Item Review** page shows generated samples at every level with their validation results. It is the internal review mechanism asked for in the brief.

## Data model

The client stores sessions as JSON. For server persistence, `src/data/schema.sql` defines the Postgres schema:

`participant`, `session`, `domain`, `facet`, `paradigm`, `item`, `item_parameter`, `response`, `ability_estimate`, `score`, `norm`, `test_form`, `experiment`, `event`.

No personal data is required. A participant is a random UUID. Device information is limited to input type (touch or mouse and keyboard), viewport class and whether reduced motion is on.

Server sync is **not implemented** in this version. Nothing in the UI suggests otherwise. Users can export their session as JSON from the report.

## UI structure

| Page | Purpose |
|---|---|
| Landing | Product statement, entry points |
| Method | How the assessment works, what it measures and what it cannot claim |
| Setup | Choose Quick, Core or Full; device and privacy notes |
| Assessment | Minimal runner: section header, progress, one item at a time |
| Report | Scientific report with uncertainty, profile, facets, performance and conditions |
| Library | Run any single instrument on its own |
| Item Review | Internal: generated items per level, keys, features, validation |

The router is hash-based with plain tokens (`#setup`, `#assessment`, `#report`, …) so the back button works and the build can be hosted on any static server. During an active assessment, navigating away pauses the session instead of discarding it.

## Performance

- Task renderers are code-split and loaded on demand.
- Timed tasks write stimuli directly to DOM nodes or canvas and read times with `performance.now()` and `event.timeStamp`. They never re-render React during a trial.
- Motion runs only on transform and opacity.
- The engine is synchronous and allocation-light. Item generation takes well under a millisecond per item, except belief tracking and tower search, which take a few milliseconds.
