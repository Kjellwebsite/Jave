import type { Stage } from '@/lib/sleep';

/**
 * Colors of the sleep charts, validated for color vision deficiency and contrast against the
 * chart card (≈ #efebfd). NREM depth is one ordinal ramp, REM and awake are separate hues.
 */
export const STAGE_COLORS: Record<Stage, string> = {
  W: '#c9831c',
  R: '#d8457f',
  N1: '#9a8eea',
  N2: '#6a5bd8',
  N3: '#3a2d9c',
};

/** Release layers, top to bottom: teal for the fast layer, blueberry for the core. */
export const LAYER_COLORS = ['#0a8fa8', '#4a4fd8'] as const;

/** "53 %", "3,5 %", German style with a no-break space. */
export function percent(value: number): string {
  const digits = value < 10 && Math.round(value * 10) % 10 !== 0 ? 1 : 0;
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits })}\u00a0%`;
}

/** Signed German number with a real minus sign, e.g. "−7,1" or "+8,3". */
export function signed(value: number, digits = 1): string {
  const text = Math.abs(value).toLocaleString('de-DE', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
  return `${value < 0 ? '−' : value > 0 ? '+' : ''}${text}`;
}
