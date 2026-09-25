# JVLN Intelligence Assessment

by Javelin. Eleven cognitive domains, one rank from **F** to **S**.

JVLN runs a short task per domain (the *Core battery*, about 40 minutes), ranks each domain against other users and combines them into an overall JVLN rank. Each task also reports finer *facets*, and preferences with no better or worse end (risk taking, loss aversion) are shown as style scales instead of ranks.

## Run it

```bash
npm install
npm run dev        # local dev server
npm run build      # typecheck + production build into dist/
npm run preview    # serve the build
```

The build uses relative paths, so `dist/` can be hosted on GitHub Pages, Netlify, Vercel or any static host.

## The Core battery

| # | Domain | Task | Primary score |
|---|---|---|---|
| 01 | Reasoning | Matrix Reasoning (generated 3×3 puzzles) | Difficulty-weighted accuracy |
| 02 | Memory | Corsi Blocks | Spatial span |
| 03 | Speed & Attention | Reaction Suite (simple + choice RT) | Median RT in ms, normed per input type |
| 04 | Executive Function | Rule Shift (card sorting with hidden rule changes) | Accuracy |
| 05 | Learning | Alien Categories (rule learning + transfer) | Learning and transfer accuracy |
| 06 | Decision Making | Odds (expected value under time pressure) | Accuracy, plus risk and loss style |
| 07 | Creativity | Remote Associates | Triads solved |
| 08 | Metacognition | Signal Check (adaptive dot comparison + confidence) | Type-2 AUROC |
| 09 | Social & Emotional | Story Minds (theory of mind stories) | Accuracy |
| 10 | Language | Word Power (vocabulary + analogies) | Accuracy |
| 11 | Perception | Motion Sense (random-dot motion, staircase) | Coherence threshold |

Generated items (matrices, sequences, deals, aliens, dots) differ on every run, so answers cannot be memorised or shared.

## Ranking

1. Each task produces a raw score.
2. The score becomes a z-score against the task's norm (`src/core/norms.ts`), then a percentile.
3. Percentile → rank: **S** top 3% · **A** top 15% · **B** top 35% · **C** middle 30% · **D** bottom 35% · **E** bottom 15% · **F** bottom 5%.
4. The overall rank combines domain z-scores, corrected for the fact that averaging correlated scores narrows their spread (`compositeZ` in `src/core/scoring.ts`).

The norms are **provisional** estimates until the backend collects real first attempts (target: 500 per task and input type). Then ranks are computed against JVLN users.

## Project layout

```
src/
  core/        engine: types, DOM helpers, shared UI, scoring, norms, storage
  tasks/       one file per task, registered in tasks/index.ts
  views/       home, task runner (intro → task → rank reveal), report
  domains.ts   the 11 domains and all facets of the JVLN model
  styles/      design tokens and styles (light + dark)
```

### Adding a task

Create `src/tasks/<name>.ts` exporting a `TaskDef`:

- `run(ctx)` draws into `ctx.stage`, calls `ctx.progress(done, total)` and returns `{ score, scoreDisplay, facets, styles?, trials }`.
- Use the helpers in `core/ui.ts` (`choose`, `textAnswer`, `interlude`, `flash`, `countIn`) and pass `ctx.signal` so the Exit button can cancel the task.
- Add a norm for the task id in `core/norms.ts` and register the task in `tasks/index.ts`.

Raw trials are stored with every result so scoring can be improved and recomputed later.

## Roadmap

- **Backend**: anonymous result collection, live user norms per task, input type and age band.
- **Deep Dives**: more tasks per domain to measure the remaining facets.
- **Creativity with AI scoring**: alternative uses, divergent association, originality compared against all answers.
- **Social**: face-based emotion recognition.
- **Share card** image for social media.

JVLN is a cognitive self-assessment for insight and fun. It is not a clinical or diagnostic test.
