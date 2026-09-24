import { describe, expect, it } from 'vitest';
import {
  el,
  escapeXml,
  fmt,
  fmtScale,
  svgDocument,
  textNode,
  translateScale,
  url,
  fragment,
} from './xml';

describe('svg writer', () => {
  it('escapes every XML special character', () => {
    expect(escapeXml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&apos;y&apos;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('writes stable, finite numbers', () => {
    expect(fmt(1 / 3)).toBe('0.333');
    expect(fmt(-0.0001)).toBe('0');
    expect(fmt(12)).toBe('12');
  });

  it('keeps scale factors precise enough for small outlined type', () => {
    // Regression: 12/720 written as 0.017 rendered the motto 2% too wide.
    const scale = 12 / 720;
    expect(Math.abs(Number(fmtScale(scale)) - scale) / scale).toBeLessThan(1e-4);
    expect(translateScale(1, 2, scale)).toBe('translate(1 2) scale(0.016667)');
  });

  it('omits null and undefined attributes', () => {
    expect(el('rect', { width: 2, fill: undefined, stroke: null })).toBe('<rect width="2"/>');
  });

  it('wraps children and escapes text', () => {
    expect(el('title', {}, textNode('A & B'))).toBe('<title>A &amp; B</title>');
  });

  it('writes a self-describing document', () => {
    const svg = svgDocument({ width: 10, height: 20, title: 'T <1>', content: fragment([], []) });
    expect(svg).toContain('viewBox="0 0 10 20"');
    expect(svg).toContain('aria-label="T &lt;1&gt;"');
    expect(svg).toContain('<title>T &lt;1&gt;</title>');
    expect(svg).not.toContain('<defs>');
  });
});

describe('BREAK: svg writer refuses injection', () => {
  it('escapes attribute values that try to break out', () => {
    const out = el('path', { d: 'M0 0" onload="alert(1)' });
    expect(out).toBe('<path d="M0 0&quot; onload=&quot;alert(1)"/>');
  });

  it.each(['on load', 'x"y', '<script', '', '1abc', 'a/b'])(
    'rejects element or attribute name %j',
    (name) => {
      expect(() => el(name)).toThrow(RangeError);
      expect(() => el('g', { [name]: 'x' })).toThrow(RangeError);
    },
  );

  it('rejects ids that could smuggle markup into url()', () => {
    expect(() => url('a) ; background:url(evil')).toThrow(RangeError);
    expect(url('ok-id')).toBe('url(#ok-id)');
  });

  it('rejects non-finite numbers', () => {
    expect(() => fmt(Number.NaN)).toThrow(RangeError);
    expect(() => fmt(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => el('rect', { width: Number.NaN })).toThrow(RangeError);
  });
});
