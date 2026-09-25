import { h } from '../core/dom';
import { rankInfo, topLabel } from '../core/scoring';
import { clearResults, getResults } from '../core/storage';
import { DOMAINS, domainById } from '../domains';
import { CORE } from '../tasks';
import { type Nav, TOTAL_FACETS, measuredFacets, overall, rankGlyph, siteFooter, siteHeader } from './common';
import { facetList, styleScale } from './taskView';

function summaryText(): string {
  const ov = overall();
  if (!ov) return '';
  const results = getResults();
  const lines = CORE.filter((t) => results[t.id]).map((t) => `${domainById(t.domain).name}: ${results[t.id].rank}`);
  return [`My JVLN rank: ${ov.rank} (${topLabel(ov.percentile)})`, lines.join(' · '), 'JVLN Intelligence Assessment by Javelin'].join('\n');
}

export function renderReport(root: HTMLElement, nav: Nav) {
  const ov = overall();
  const results = getResults();
  if (!ov) {
    nav.home();
    return;
  }
  const info = rankInfo(ov.rank);
  const measured = measuredFacets();

  const hero = h(
    'section',
    { class: 'report-hero' },
    rankGlyph(ov.rank, 'rank-glyph-xl is-reveal'),
    h(
      'div',
      { class: 'report-hero-text' },
      h('p', { class: 'eyebrow' }, ov.done.length < CORE.length ? `Provisional · ${ov.done.length} of ${CORE.length} domains` : 'JVLN rank · all 11 domains'),
      h('h1', { class: 'report-title' }, info.label),
      h('p', { class: 'report-top mono' }, `${topLabel(ov.percentile)} of JVLN users`),
      h(
        'div',
        { class: 'completeness' },
        h('div', { class: 'completeness-track' }, h('span', { style: { width: `${(measured / TOTAL_FACETS) * 100}%` } })),
        h('p', { class: 'completeness-label' }, `Profile ${Math.round((measured / TOTAL_FACETS) * 100)}% complete · ${measured} of ${TOTAL_FACETS} facets measured`),
      ),
    ),
  );

  // Domain bars: marker at the user's percentile, coloured by rank.
  const bars = h(
    'ol',
    { class: 'domain-bars' },
    ...CORE.map((task) => {
      const r = results[task.id];
      const domain = domainById(task.domain);
      if (!r) {
        return h(
          'li',
          { class: 'domain-bar is-empty' },
          h('span', { class: 'domain-bar-name' }, domain.name),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => nav.task(task.id, 'single') }, `Take ${task.name}`),
        );
      }
      return h(
        'li',
        { class: `domain-bar rank-${r.rank.toLowerCase()}` },
        h('span', { class: 'domain-bar-name' }, domain.name),
        h(
          'span',
          { class: 'domain-bar-track', role: 'img', 'aria-label': `${domain.name}: ${topLabel(r.percentile)}` },
          h('span', { class: 'domain-bar-mid' }),
          h('span', { class: 'domain-bar-fill', style: { width: `${r.percentile}%` } }),
        ),
        h('span', { class: 'domain-bar-top mono' }, topLabel(r.percentile)),
        rankGlyph(r.rank, 'rank-glyph-sm'),
      );
    }),
  );

  const done = CORE.filter((t) => results[t.id]);
  const strongest = [...done].sort((a, b) => results[b.id].z - results[a.id].z)[0];
  const weakest = [...done].sort((a, b) => results[a.id].z - results[b.id].z)[0];
  const highlights =
    done.length >= 2
      ? h(
          'div',
          { class: 'highlights' },
          h('div', null, h('p', { class: 'eyebrow' }, 'Top strength'), h('p', { class: 'highlight' }, domainById(strongest.domain).name)),
          h('div', null, h('p', { class: 'eyebrow' }, 'Most room to grow'), h('p', { class: 'highlight' }, domainById(weakest.domain).name)),
        )
      : null;

  const styles = done.flatMap((t) => results[t.id].output.styles ?? []);

  const details = done.map((task) => {
    const r = results[task.id];
    const domain = DOMAINS.find((d) => d.id === task.domain)!;
    const unmeasured = domain.facets.filter((f) => !task.measures.includes(f)).length;
    return h(
      'details',
      { class: 'domain-detail' },
      h('summary', null, rankGlyph(r.rank, 'rank-glyph-sm'), h('span', null, domain.name), h('span', { class: 'mono domain-detail-task' }, task.name)),
      facetList(r),
      h('p', { class: 'domain-detail-more' }, `${unmeasured} more ${domain.name} facets unlock with the Deep Dive (coming soon).`),
    );
  });

  // Share and reset
  const copyBtn = h('button', { class: 'btn btn-primary', type: 'button' }, 'Copy result');
  const copyArea = h('textarea', { id: 'share-text', class: 'share-text', readonly: true, rows: '3', hidden: true });
  copyBtn.addEventListener('click', async () => {
    const text = summaryText();
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied';
    } catch {
      copyArea.value = text;
      copyArea.hidden = false;
      copyArea.select();
      copyBtn.textContent = 'Select and copy the text';
    }
  });
  const resetConfirm = h(
    'div',
    { class: 'confirm-inline', hidden: true },
    h('span', null, 'Delete all results on this device?'),
    h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => { clearResults(); nav.home(); } }, 'Delete'),
    h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => (resetConfirm.hidden = true) }, 'Cancel'),
  );
  const resetBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => (resetConfirm.hidden = false) }, 'Reset results');

  root.replaceChildren(
    h(
      'div',
      { class: 'page' },
      siteHeader(nav, true),
      hero,
      highlights,
      h('section', { class: 'report-section' }, h('div', { class: 'section-head' }, h('h2', null, 'Domains'), h('p', null, 'Bar length shows your percentile. The tick marks the middle of all users.')), bars),
      styles.length
        ? h(
            'section',
            { class: 'report-section' },
            h('div', { class: 'section-head' }, h('h2', null, 'Style profile'), h('p', null, 'Preferences, not abilities. Neither end is better, so these are never ranked.')),
            h('div', { class: 'styles' }, ...styles.map((s) => styleScale(s.name, s.left, s.right, s.value))),
          )
        : null,
      h('section', { class: 'report-section' }, h('div', { class: 'section-head' }, h('h2', null, 'Facets'), h('p', null, 'The detail behind each domain rank.')), ...details),
      h('section', { class: 'report-section report-actions' }, copyBtn, resetBtn, copyArea, resetConfirm),
      siteFooter(),
    ),
  );
  window.scrollTo(0, 0);
}
