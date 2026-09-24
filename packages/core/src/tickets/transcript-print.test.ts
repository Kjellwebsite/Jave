import { describe, expect, it } from 'vitest';
import { renderHtml, type TranscriptModel } from './transcript';

/** WCAG 2.x minimums: body text, and non-text UI such as rules and tag outlines. */
const TEXT_CONTRAST_MIN = 4.5;
const UI_CONTRAST_MIN = 3;

interface CssRule {
  selectors: string[];
  declarations: Map<string, string>;
}

/** Minimal parser for the transcript's own flat stylesheet (no nesting besides @media print). */
function parseRules(css: string): CssRule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1]!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    declarations: new Map(
      match[2]!
        .split(';')
        .map((d) => d.split(':'))
        .filter((parts) => parts.length >= 2)
        .map(([name, ...value]) => [name!.trim(), value.join(':').trim()]),
    ),
  }));
}

function stylesheet(): { screen: CssRule[]; print: CssRule[] } {
  const model: TranscriptModel = {
    reference: '#0001',
    subject: 'Subject',
    category: 'technical',
    priority: 'normal',
    status: 'open',
    openedAt: new Date(0),
    closedAt: null,
    closeReason: null,
    opener: 'Ada',
    assignee: null,
    reopenCount: 0,
    generatedAt: new Date(0),
    includesInternal: false,
    sla: null,
    aiSummary: null,
    messages: [],
    events: [],
    truncated: false,
  };
  const css = /<style>([\s\S]*)<\/style>/.exec(renderHtml(model))![1]!;
  const [screen, print] = css.split('@media print');
  expect(print, 'the transcript has a print stylesheet').toBeDefined();
  return { screen: parseRules(screen!), print: parseRules(print!) };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not a #rrggbb color: ${hex}`);
  const [r, g, b] = [match[1]!, match[2]!, match[3]!].map((h) => channel(parseInt(h, 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Color at the end of a `border` shorthand or a plain `border-color`. */
const lastHex = (value: string) => /#[0-9a-f]{6}\b(?!.*#[0-9a-f]{6})/i.exec(value)?.[0];

describe('transcript print stylesheet', () => {
  it('BREAK: every screen color and background is overridden for paper by the same selector', () => {
    const { screen, print } = stylesheet();
    const printed = (selector: string, property: string) =>
      print.some((r) => r.selectors.includes(selector) && r.declarations.has(property));
    const missing: string[] = [];
    for (const rule of screen) {
      for (const property of ['color', 'background']) {
        if (!rule.declarations.has(property)) continue;
        for (const selector of rule.selectors) {
          if (!printed(selector, property)) missing.push(`${selector} { ${property} }`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('prints every text color at 4.5:1 or better and every rule at 3:1 or better on white', () => {
    const { print } = stylesheet();
    const paper = print.find((r) => r.selectors.includes('body'))!.declarations.get('background')!;
    expect(paper.toUpperCase()).toBe('#FFFFFF');
    const failures: string[] = [];
    for (const rule of print) {
      const text = rule.declarations.get('color');
      if (text && contrast(text, paper) < TEXT_CONTRAST_MIN) {
        failures.push(`${rule.selectors.join(', ')} color ${text}`);
      }
      for (const property of ['border-color', 'border']) {
        const border = lastHex(rule.declarations.get(property) ?? '');
        if (border && contrast(border, paper) < UI_CONTRAST_MIN) {
          failures.push(`${rule.selectors.join(', ')} ${property} ${border}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps the elements named in the review legible on paper', () => {
    const { print } = stylesheet();
    const colorOf = (selector: string) =>
      print
        .find((r) => r.selectors.includes(selector) && r.declarations.has('color'))
        ?.declarations.get('color');
    for (const selector of ['.subject', 'h2', '.tag', '.tag.alert', 'a', '.kicker', 'dt']) {
      expect(contrast(colorOf(selector)!, '#FFFFFF'), selector).toBeGreaterThanOrEqual(
        TEXT_CONTRAST_MIN,
      );
    }
    for (const selector of ['.time', '.event', 'footer', '.truncated']) {
      expect(colorOf(selector), selector).toBeDefined();
    }
  });

  it('the contrast helper matches known WCAG values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // The pre-fix print colors the review measured: accent 1.9:1, link text 1.2:1.
    expect(contrast('#B8BDC3', '#FFFFFF')).toBeLessThan(2);
    expect(contrast('#E8EAED', '#FFFFFF')).toBeLessThan(1.3);
  });
});
