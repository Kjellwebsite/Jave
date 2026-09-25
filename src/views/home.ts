import { h } from '../core/dom';
import { RANKS, topLabel } from '../core/scoring';
import { getResults } from '../core/storage';
import { domainById } from '../domains';
import { CORE } from '../tasks';
import { type Nav, nextIncomplete, overall, rankGlyph, siteFooter, siteHeader } from './common';

function rankLadder(): HTMLElement {
  const steps = [...RANKS].reverse();
  return h(
    'div',
    { class: 'ladder', role: 'img', 'aria-label': 'Ranks from F, the bottom 5 percent, up to S, the top 3 percent' },
    ...steps.map((r) =>
      h(
        'div',
        { class: `ladder-step rank-${r.rank.toLowerCase()}` },
        h('span', { class: 'ladder-letter' }, r.rank),
        h('span', { class: 'ladder-band' }, ...r.band.split(' ').map((part) => h('span', null, part))),
      ),
    ),
  );
}

export function renderHome(root: HTMLElement, nav: Nav) {
  const results = getResults();
  const total = CORE.reduce((s, t) => s + t.minutes, 0);
  const next = nextIncomplete();
  const ov = overall();

  const primary = next
    ? h(
        'button',
        { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => nav.task(next.id, 'core') },
        ov ? `Continue with ${next.name}` : 'Start JVLN Core',
      )
    : h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => nav.report() }, 'See your JVLN report');

  const hero = h(
    'section',
    { class: 'hero' },
    h('p', { class: 'eyebrow' }, 'Intelligence Assessment · Core battery'),
    h('h1', { class: 'hero-title' }, 'Eleven domains.', h('br'), h('em', null, 'One rank.')),
    h(
      'p',
      { class: 'hero-lede' },
      'JVLN measures how you reason, remember, learn, decide and perceive, then ranks you from F to S against everyone who has taken it.',
    ),
    h(
      'div',
      { class: 'hero-actions' },
      primary,
      h('span', { class: 'hero-meta mono' }, `${CORE.length} tasks · about ${total} min · no account`),
    ),
    rankLadder(),
  );

  const summary = ov
    ? h(
        'section',
        { class: 'home-summary' },
        rankGlyph(ov.rank, 'rank-glyph-md'),
        h(
          'div',
          null,
          h('p', { class: 'eyebrow' }, ov.done.length < CORE.length ? 'Provisional JVLN rank' : 'Your JVLN rank'),
          h('p', { class: 'home-summary-line' }, `${topLabel(ov.percentile)} · ${ov.done.length} of ${CORE.length} domains done`),
        ),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => nav.report() }, 'Open report'),
      )
    : null;

  const rows = CORE.map((task, i) => {
    const r = results[task.id];
    return h(
      'li',
      null,
      h(
        'button',
        { class: `battery-row ${r ? 'is-done' : ''}`, type: 'button', onclick: () => nav.task(task.id, 'single') },
        h('span', { class: 'battery-num mono' }, String(i + 1).padStart(2, '0')),
        h(
          'span',
          { class: 'battery-main' },
          h('span', { class: 'battery-domain' }, domainById(task.domain).name),
          h('span', { class: 'battery-task' }, `${task.name} · ${task.tagline}`),
        ),
        h('span', { class: 'battery-time mono' }, `${task.minutes} min`),
        r ? rankGlyph(r.rank, 'rank-glyph-sm') : h('span', { class: 'battery-go', 'aria-hidden': 'true' }, '→'),
      ),
    );
  });

  root.replaceChildren(
    h(
      'div',
      { class: 'page' },
      siteHeader(nav),
      hero,
      summary,
      h(
        'section',
        { class: 'battery' },
        h(
          'div',
          { class: 'section-head' },
          h('h2', null, 'The Core battery'),
          h('p', null, 'Run them in order or pick any single task. Each one ranks one domain. Deep Dives with more facets per domain come later.'),
        ),
        h('ol', { class: 'battery-list' }, rows),
      ),
      siteFooter(),
    ),
  );
}
