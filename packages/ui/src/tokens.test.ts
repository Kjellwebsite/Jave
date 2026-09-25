import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LEGIBLE_TEXT_ROLES,
  neutral,
  palette,
  radii,
  type SemanticColors,
  TEXT_SURFACES,
  themes,
  typeScale,
} from './tokens';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

/** The `@theme { … }` block (dark semantic defaults live here). */
const themeBlock = css.slice(css.indexOf('@theme {'), css.indexOf("[data-theme='light']"));
const lightBlock = css.slice(css.indexOf("[data-theme='light']"), css.indexOf('@layer base'));

const WCAG_AA_NORMAL_TEXT = 4.5;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function declares(block: string, variable: string, value: string): boolean {
  return new RegExp(`${variable}:\\s*${value};`, 'i').test(block);
}

describe('tokens ↔ styles.css', () => {
  it('declares every palette colour in the Tailwind theme', () => {
    for (const [name, hex] of Object.entries(palette)) {
      expect(declares(themeBlock, `--color-${name}`, hex), name).toBe(true);
    }
  });

  it('declares the full neutral ramp', () => {
    for (const [step, hex] of Object.entries(neutral)) {
      expect(declares(themeBlock, `--color-neutral-${step}`, hex), step).toBe(true);
    }
  });

  it.each(['dark', 'light'] as const)('mirrors every %s semantic colour', (theme) => {
    const block = theme === 'dark' ? themeBlock : lightBlock;
    for (const [role, hex] of Object.entries(themes[theme])) {
      expect(declares(block, `--color-${role}`, hex), `${theme}.${role}`).toBe(true);
    }
  });

  it('keeps a single radius system', () => {
    for (const [name, value] of Object.entries(radii)) {
      expect(declares(themeBlock, `--radius-${name}`, value), name).toBe(true);
    }
    expect(themeBlock).toContain('--radius-*: initial;');
  });

  it('mirrors the type scale sizes', () => {
    for (const [name, style] of Object.entries(typeScale)) {
      const rem = `${style.sizePx / 16}rem`;
      expect(declares(themeBlock, `--text-${name}`, rem.replace('.', '\\.')), name).toBe(true);
    }
  });

  it('never uses Orbitron for body-level styles', () => {
    for (const name of ['heading', 'body', 'small'] as const) {
      expect(typeScale[name].family).toBe('sans');
    }
    for (const name of ['display', 'title'] as const) {
      expect(typeScale[name].family).toBe('display');
      expect(typeScale[name].uppercase).toBe(true);
      expect(typeScale[name].tracking).toBeGreaterThanOrEqual(0.1);
    }
  });
});

describe('WCAG AA legibility', () => {
  it.each(['dark', 'light'] as const)(
    'every text role reaches 4.5:1 on every %s surface',
    (theme) => {
      const colors: SemanticColors = themes[theme];
      const failures: string[] = [];
      for (const role of LEGIBLE_TEXT_ROLES) {
        for (const surface of TEXT_SURFACES) {
          const ratio = contrast(colors[role], colors[surface]);
          if (ratio < WCAG_AA_NORMAL_TEXT)
            failures.push(`${role} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
    },
  );

  it('keeps white text on the solid danger fill legible', () => {
    expect(contrast('#FFFFFF', themes.dark['danger-solid'])).toBeGreaterThanOrEqual(
      WCAG_AA_NORMAL_TEXT,
    );
  });

  it('keeps the primary action label legible', () => {
    for (const theme of ['dark', 'light'] as const) {
      const colors = themes[theme];
      expect(contrast(colors['action-fg'], colors.action)).toBeGreaterThanOrEqual(
        WCAG_AA_NORMAL_TEXT,
      );
    }
  });
});
