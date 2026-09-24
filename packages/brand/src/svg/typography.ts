/**
 * Outlined type. Text is converted to paths at render time (see
 * `scripts/lib/outline-text.ts`) so no asset depends on an installed font.
 */
import { el, translateScale } from './xml';

export interface OutlinedText {
  readonly text: string;
  /** Path data with the baseline at y = 0, ink starting at x = 0, y pointing down. */
  readonly d: string;
  /** Ink width in path units. */
  readonly width: number;
  /** Height of capitals above the baseline, in path units. */
  readonly capHeight: number;
}

/** The outlined strings every brand asset needs. */
export interface BrandTypography {
  readonly wordmark: OutlinedText;
  readonly motto: OutlinedText;
}

export type TextAlign = 'start' | 'center' | 'end';

export interface TextPlacement {
  readonly x: number;
  readonly baselineY: number;
  /** Rendered height of capitals, in output units. */
  readonly capHeight: number;
  readonly align: TextAlign;
  readonly fill: string;
  readonly opacity?: number;
}

/** Rendered width of outlined text at a given cap height. */
export function textWidth(text: OutlinedText, capHeight: number): number {
  return (text.width * capHeight) / text.capHeight;
}

const ALIGN_FACTOR: Readonly<Record<TextAlign, number>> = { start: 0, center: 0.5, end: 1 };

export function placeText(text: OutlinedText, placement: TextPlacement): string {
  const scale = placement.capHeight / text.capHeight;
  const left = placement.x - textWidth(text, placement.capHeight) * ALIGN_FACTOR[placement.align];
  return el('path', {
    d: text.d,
    fill: placement.fill,
    opacity: placement.opacity,
    transform: translateScale(left, placement.baselineY, scale),
  });
}
