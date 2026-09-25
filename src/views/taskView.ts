import { detectInput } from '../core/device';
import { Aborted, h } from '../core/dom';
import { MIN_SAMPLE } from '../core/norms';
import { percentileFromZ, rankFromPercentile, rankInfo, topLabel, zScore } from '../core/scoring';
import { nextAttempt, saveResult } from '../core/storage';
import type { StoredResult, TaskContext, TaskDef } from '../core/types';
import { continueButton } from '../core/ui';
import { domainById } from '../domains';
import { CORE } from '../tasks';
import { type Nav, nextIncomplete, rankGlyph } from './common';

function styleScale(name: string, left: string, right: string, value: number): HTMLElement {
  return h(
    'div',
    { class: 'scale' },
    h('div', { class: 'scale-name' }, name),
    h(
      'div',
      { class: 'scale-track', role: 'img', 'aria-label': `${name}: ${Math.round(value * 100)}% toward ${right}` },
      h('span', { class: 'scale-dot', style: { left: `${value * 100}%` } }),
    ),
    h('div', { class: 'scale-ends' }, h('span', null, left), h('span', null, right)),
  );
}

export function facetList(result: StoredResult): HTMLElement {
  return h(
    'dl',
    { class: 'facets' },
    ...result.output.facets.map((f) =>
      h(
        'div',
        { class: 'facet' },
        h('dt', null, f.facet),
        h('dd', null, h('span', { class: 'facet-value mono' }, f.display), f.note ? h('span', { class: 'facet-note' }, f.note) : null),
      ),
    ),
  );
}

export function styleList(result: StoredResult): HTMLElement | null {
  const styles = result.output.styles;
  if (!styles?.length) return null;
  return h('div', { class: 'styles' }, ...styles.map((s) => styleScale(s.name, s.left, s.right, s.value)));
}

export { styleScale };

export async function renderTask(root: HTMLElement, task: TaskDef, mode: 'core' | 'single', nav: Nav) {
  const controller = new AbortController();
  const domain = domainById(task.domain);
  const index = CORE.indexOf(task);
  const fill = h('span');
  const count = h('span', { class: 'task-top-count mono' }, `${String(index + 1).padStart(2, '0')} / ${CORE.length}`);
  let running = false;

  const confirmBar = h(
    'div',
    { class: 'confirm-bar', hidden: true, role: 'alertdialog', 'aria-label': 'Leave task' },
    h('span', null, 'Leave this task? Answers from this run are not saved.'),
    h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => leave() }, 'Leave'),
    h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => (confirmBar.hidden = true) }, 'Stay'),
  );
  const leave = () => {
    controller.abort();
    cleanup();
    nav.home();
  };
  const exit = h(
    'button',
    {
      class: 'task-exit',
      type: 'button',
      onclick: () => (running ? (confirmBar.hidden = false) : leave()),
    },
    '← Exit',
  );
  const top = h(
    'header',
    { class: 'task-top' },
    exit,
    h('div', { class: 'task-top-title' }, h('span', { class: 'eyebrow' }, domain.name), h('strong', null, task.name)),
    count,
    h('div', { class: 'task-progress', 'aria-hidden': 'true' }, fill),
  );
  const stage = h('main', { class: 'stage' });
  root.replaceChildren(h('div', { class: 'task-view' }, top, confirmBar, stage));
  window.scrollTo(0, 0);

  let interrupted = false;
  const onVisibility = () => {
    if (running && document.hidden) interrupted = true;
  };
  document.addEventListener('visibilitychange', onVisibility);
  const cleanup = () => document.removeEventListener('visibilitychange', onVisibility);

  const input = detectInput();
  const ctx: TaskContext = {
    stage,
    input,
    signal: controller.signal,
    progress: (done, total) => {
      fill.style.width = `${Math.min(100, (done / Math.max(1, total)) * 100)}%`;
    },
  };

  try {
    // Intro
    const intro = h(
      'section',
      { class: 'intro' },
      h('p', { class: 'eyebrow' }, `${domain.name} · ${task.minutes} min`),
      h('h1', { class: 'intro-title' }, task.name),
      h('p', { class: 'intro-tagline' }, task.tagline),
      h('ol', { class: 'intro-steps' }, ...task.instructions.map((line) => h('li', null, line))),
      h('div', { class: 'intro-measures' }, h('span', { class: 'eyebrow' }, 'Measures'), h('div', { class: 'chips' }, ...task.measures.map((m) => h('span', { class: 'chip' }, m)))),
    );
    stage.replaceChildren(intro);
    await continueButton(intro, 'Begin', controller.signal);

    running = true;
    stage.replaceChildren();
    const output = await task.run(ctx);
    running = false;
    confirmBar.hidden = true;
    cleanup();

    const z = zScore(task.id, output.score, input);
    const percentile = percentileFromZ(z);
    const result: StoredResult = {
      taskId: task.id,
      domain: task.domain,
      completedAt: new Date().toISOString(),
      input,
      attempt: nextAttempt(task.id),
      interrupted,
      z,
      percentile,
      rank: rankFromPercentile(percentile),
      output,
    };
    saveResult(result);
    renderResult(stage, task, result, mode, nav);
    count.textContent = 'Result';
  } catch (err) {
    cleanup();
    if (!(err instanceof Aborted)) throw err;
  }
}

function renderResult(stage: HTMLElement, task: TaskDef, result: StoredResult, mode: 'core' | 'single', nav: Nav) {
  const info = rankInfo(result.rank);
  const next = nextIncomplete();
  const actions: HTMLElement[] = [];
  if (mode === 'core' && next) {
    actions.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => nav.task(next.id, 'core') }, `Next: ${next.name}`));
  } else if (!next) {
    actions.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => nav.report() }, 'See your JVLN report'));
  } else {
    actions.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => nav.home() }, 'Back to overview'));
  }
  actions.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => nav.task(task.id, mode) }, 'Retake'));
  if (mode === 'core' || !next) actions.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => nav.home() }, 'Overview'));

  const notes: string[] = [`Provisional until ${MIN_SAMPLE} people have taken ${task.name}`];
  if (result.attempt > 1) notes.push(`Attempt ${result.attempt}. Practice makes later attempts easier`);
  if (result.interrupted) notes.push('You switched away during the task, so this result may be less accurate');
  if (task.id === 'reaction') notes.push(`Compared with other ${result.input === 'touch' ? 'touch screen' : 'mouse and keyboard'} users`);

  stage.replaceChildren(
    h(
      'section',
      { class: 'result' },
      h('p', { class: 'eyebrow' }, `${domainById(task.domain).name} · ${task.name}`),
      h(
        'div',
        { class: 'result-hero' },
        rankGlyph(result.rank, 'rank-glyph-xl is-reveal'),
        h(
          'div',
          { class: 'result-headline' },
          h('p', { class: 'result-label' }, info.label),
          h('p', { class: 'result-top mono' }, topLabel(result.percentile)),
          h('p', { class: 'result-score' }, result.output.scoreDisplay),
        ),
      ),
      h('ul', { class: 'result-notes' }, ...notes.map((n) => h('li', null, n))),
      h('h2', { class: 'result-sub' }, 'Facets'),
      facetList(result),
      styleList(result) ? h('h2', { class: 'result-sub' }, 'Your style') : null,
      styleList(result),
      h('div', { class: 'result-actions' }, ...actions),
    ),
  );
  window.scrollTo(0, 0);
}
