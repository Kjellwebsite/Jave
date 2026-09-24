/**
 * The brand's type settings: which Orbitron weight and tracking each string
 * uses. Fonts are committed under `fonts/` (SIL OFL 1.1, see `fonts/OFL.txt`).
 */
import { fileURLToPath } from 'node:url';
import { BRAND_MOTTO, BRAND_NAME } from '../../src/copy';
import type { BrandTypography } from '../../src/svg/typography';
import { loadFont, outlineText } from './outline-text';

const FONTS_DIR = fileURLToPath(new URL('../../fonts/', import.meta.url));

export const WORDMARK_FONT_FILE = 'Orbitron-600.ttf';
export const MOTTO_FONT_FILE = 'Orbitron-600.ttf';

/** Wide, even tracking gives the wordmark its engineered, instrument-panel feel. */
export const WORDMARK_TRACKING_EM = 0.22;
/** The motto is set small, so it is tracked wider still to stay legible. */
export const MOTTO_TRACKING_EM = 0.32;

export function fontPath(file: string): string {
  return `${FONTS_DIR}${file}`;
}

export function loadBrandTypography(): BrandTypography {
  return {
    wordmark: outlineText(loadFont(fontPath(WORDMARK_FONT_FILE)), BRAND_NAME, {
      trackingEm: WORDMARK_TRACKING_EM,
    }),
    motto: outlineText(loadFont(fontPath(MOTTO_FONT_FILE)), BRAND_MOTTO, {
      trackingEm: MOTTO_TRACKING_EM,
    }),
  };
}
