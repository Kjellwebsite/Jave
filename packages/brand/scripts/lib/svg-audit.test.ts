import { describe, expect, it } from 'vitest';
import { auditSvgPaint, parseSvgElements } from './svg-audit';

const PALETTE = new Set(['#E8EAED', '#181A1D', '#FFFFFF']);
const NEUTRAL_MATRIX = '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  6 0 0 0 -3';

function doc(body: string, defs = ''): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" role="img" aria-label="T &amp; U">',
    '<title>T &amp; U</title>',
    `<defs>${defs}</defs>`,
    body,
    '</svg>',
  ].join('\n');
}

/** A turbulence filter shaped like the kit's brushed grain, with `body` after the noise. */
function grainFilter(body: string): string {
  return `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.004 0.8" result="noise"/>${body}</filter>`;
}

const CLEAN = doc(
  '<rect width="10" height="10" fill="url(#g)"/><g fill="#e8eaed"><path d="M0 0 L1 1 Z"/></g><path d="M0 0 L2 2 Z" fill="currentColor" stroke="none"/>',
  '<linearGradient id="g"><stop offset="0" stop-color="#181A1D"/></linearGradient><clipPath id="c"><rect width="5" height="5"/></clipPath><filter id="f"><feColorMatrix type="matrix" values="' +
    NEUTRAL_MATRIX +
    '"/><feFlood flood-color="#FFFFFF"/></filter>' +
    grainFilter(
      `<feColorMatrix in="noise" type="matrix" values="${NEUTRAL_MATRIX}" result="grey"/>`,
    ),
);

describe('svg audit', () => {
  it('accepts palette hex (any case), none, currentColor, local references and inherited fills', () => {
    expect(auditSvgPaint(CLEAN, PALETTE)).toEqual([]);
  });

  it('tracks nesting', () => {
    const elements = parseSvgElements(CLEAN);
    const nested = elements.find((e) => e.attributes.get('d') === 'M0 0 L1 1 Z');
    expect(nested?.ancestors.map((a) => a.name)).toEqual(['svg', 'g']);
  });

  it.each([
    ['a named colour', 'purple'],
    ['3-digit hex', '#f0f'],
    ['rgb()', 'rgb(0,255,200)'],
    ['hsl()', 'hsl(280 100% 50%)'],
    ['8-digit hex with alpha', '#FF00FF80'],
    ['a hex outside the palette', '#7F00FF'],
    ['a dangling reference', 'url(#missing)'],
    ['an external reference', 'url(https://example.com/x.svg#a)'],
  ])('BREAK: rejects %s as a fill, stroke or stop colour', (_kind, value) => {
    for (const markup of [
      doc(`<path d="M0 0 L1 1 Z" fill="${value}"/>`),
      doc(`<path d="M0 0 L1 1 Z" fill="none" stroke="${value}"/>`),
      doc('', `<linearGradient id="g"><stop offset="0" stop-color="${value}"/></linearGradient>`),
      doc('', `<filter id="f"><feFlood flood-color="${value}"/></filter>`),
    ]) {
      expect(auditSvgPaint(markup, PALETTE)).not.toEqual([]);
    }
  });

  it('BREAK: rejects inline CSS, style sheets and animation', () => {
    expect(
      auditSvgPaint(doc('<path d="M0 0" fill="none" style="fill:purple"/>'), PALETTE),
    ).not.toEqual([]);
    expect(auditSvgPaint(doc('<style>path{fill:purple}</style>'), PALETTE)).not.toEqual([]);
    expect(
      auditSvgPaint(
        doc(
          '<rect width="1" height="1" fill="#FFFFFF"><animate attributeName="fill" values="purple"/></rect>',
        ),
        PALETTE,
      ),
    ).not.toEqual([]);
  });

  it('BREAK: rejects colour matrices that can tint', () => {
    const tint = '0 0 0 0 0.5  0 0 0 0 0  0 0 0 0 1  1 0 0 0 0';
    expect(
      auditSvgPaint(
        doc('', `<filter id="f"><feColorMatrix type="matrix" values="${tint}"/></filter>`),
        PALETTE,
      ),
    ).not.toEqual([]);
    expect(
      auditSvgPaint(
        doc('', '<filter id="f"><feColorMatrix type="hueRotate" values="90"/></filter>'),
        PALETTE,
      ),
    ).not.toEqual([]);
  });

  it('BREAK: rejects shapes left on the default black fill, outside clip paths', () => {
    expect(auditSvgPaint(doc('<path d="M0 0 L1 1 Z"/>'), PALETTE)).not.toEqual([]);
  });

  it('BREAK: refuses markup it cannot account for', () => {
    expect(() => parseSvgElements(doc('<path d="M0 0" fill=purple/>'))).toThrow(SyntaxError);
    expect(() => parseSvgElements(doc("<path d='M0 0' fill='purple'/>"))).toThrow(SyntaxError);
    expect(() => parseSvgElements(doc('<!-- fill="purple" --><g></g>'))).toThrow(SyntaxError);
    expect(() => parseSvgElements('<svg><g></svg>')).toThrow(SyntaxError);
    expect(() => parseSvgElements('<svg><path fill="a" fill="b"/></svg>')).toThrow(SyntaxError);
  });

  it.each([
    ['as the filter output', ''],
    ['into a composite', '<feComposite in="noise" in2="SourceAlpha" operator="in"/>'],
    ['as a composite’s second input', '<feComposite in="SourceAlpha" in2="noise" operator="in"/>'],
    ['into a blur, implicitly', '<feGaussianBlur stdDeviation="1"/>'],
    ['into a merge', '<feMerge><feMergeNode in="noise"/></feMerge>'],
  ])('BREAK: rejects raw (coloured) turbulence noise %s', (_how, body) => {
    expect(auditSvgPaint(doc('', grainFilter(body)), PALETTE)).not.toEqual([]);
  });

  it('lets a later primitive reuse a noise result name once it is grey', () => {
    const rebound = grainFilter(
      `<feColorMatrix in="noise" type="matrix" values="${NEUTRAL_MATRIX}" result="noise"/><feComposite in="noise" in2="SourceAlpha" operator="in"/>`,
    );
    expect(auditSvgPaint(doc('', rebound), PALETTE)).toEqual([]);
  });
});
