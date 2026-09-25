/**
 * Wordmark and lockups. The wordmark is JAVELIN in Orbitron with wide
 * tracking, outlined. Lockups pair it with the emblem at fixed proportions.
 */
import { BRAND_COLORS } from '../colors';
import {
  EMBLEM_FINISHES,
  emblemArt,
  emblemSilhouette,
  emblemWidthForHeight,
  placementInBox,
  type EmblemFinish,
} from './emblem-art';
import { placeText, textWidth, type BrandTypography } from './typography';
import { combine, fragment, svgDocument, type Fragment } from './xml';

/** `dark` is for dark surfaces (the default), `light` for light ones. */
export type LockupTone = 'dark' | 'light' | 'mono';

interface ToneSpec {
  /** null draws a `currentColor` silhouette. */
  readonly emblem: EmblemFinish | null;
  readonly text: string;
}

const TONES: Readonly<Record<LockupTone, ToneSpec>> = {
  dark: { emblem: EMBLEM_FINISHES.metallic, text: BRAND_COLORS.chrome },
  light: { emblem: EMBLEM_FINISHES.onLight, text: BRAND_COLORS.graphite },
  mono: { emblem: null, text: 'currentColor' },
};

/** Wordmark cap height relative to the emblem height in a horizontal lockup. */
const HORIZONTAL_CAP_RATIO = 0.3;
/** Space between emblem and wordmark, relative to the emblem height. */
const HORIZONTAL_GAP_RATIO = 0.3;
/**
 * Where the wordmark's cap centre sits on the emblem, from its top (0) to
 * bottom (1). The emblem's weight is low (the wings), so text aligns just
 * below the geometric middle.
 */
const HORIZONTAL_TEXT_CENTER_RATIO = 0.54;
/** Wordmark cap height relative to the emblem height in a stacked lockup. */
const STACKED_CAP_RATIO = 0.17;
const STACKED_GAP_RATIO = 0.24;

export interface LockupBox {
  readonly width: number;
  readonly height: number;
}

interface ToneOptions {
  readonly id: string;
  readonly typography: BrandTypography;
  readonly tone: LockupTone;
}

function toneEmblem(options: ToneOptions, left: number, top: number, height: number): Fragment {
  const placement = placementInBox(left, top, height);
  const finish = TONES[options.tone].emblem;
  return finish
    ? emblemArt({ id: `${options.id}-emblem`, finish, placement })
    : emblemSilhouette(placement);
}

export function wordmarkArt(
  options: ToneOptions & {
    readonly x: number;
    readonly baselineY: number;
    readonly capHeight: number;
  },
): Fragment {
  return fragment(
    [],
    [
      placeText(options.typography.wordmark, {
        x: options.x,
        baselineY: options.baselineY,
        capHeight: options.capHeight,
        align: 'start',
        fill: TONES[options.tone].text,
      }),
    ],
  );
}

export function horizontalLockupBox(typography: BrandTypography, emblemHeight: number): LockupBox {
  const capHeight = emblemHeight * HORIZONTAL_CAP_RATIO;
  const gap = emblemHeight * HORIZONTAL_GAP_RATIO;
  return {
    width: emblemWidthForHeight(emblemHeight) + gap + textWidth(typography.wordmark, capHeight),
    height: emblemHeight,
  };
}

/** Emblem left, wordmark right. `left`/`top` is the box's top-left corner. */
export function horizontalLockup(
  options: ToneOptions & {
    readonly left: number;
    readonly top: number;
    readonly emblemHeight: number;
  },
): Fragment {
  const { emblemHeight } = options;
  const capHeight = emblemHeight * HORIZONTAL_CAP_RATIO;
  const textLeft =
    options.left + emblemWidthForHeight(emblemHeight) + emblemHeight * HORIZONTAL_GAP_RATIO;
  const baselineY = options.top + emblemHeight * HORIZONTAL_TEXT_CENTER_RATIO + capHeight / 2;
  return combine(
    toneEmblem(options, options.left, options.top, emblemHeight),
    wordmarkArt({ ...options, x: textLeft, baselineY, capHeight }),
  );
}

export function stackedLockupBox(typography: BrandTypography, emblemHeight: number): LockupBox {
  const capHeight = emblemHeight * STACKED_CAP_RATIO;
  return {
    width: Math.max(emblemWidthForHeight(emblemHeight), textWidth(typography.wordmark, capHeight)),
    height: emblemHeight * (1 + STACKED_GAP_RATIO + STACKED_CAP_RATIO),
  };
}

/** Emblem above, wordmark below, both centred on `centerX`. */
export function stackedLockup(
  options: ToneOptions & {
    readonly centerX: number;
    readonly top: number;
    readonly emblemHeight: number;
  },
): Fragment {
  const { emblemHeight, centerX, top } = options;
  const capHeight = emblemHeight * STACKED_CAP_RATIO;
  const emblemLeft = centerX - emblemWidthForHeight(emblemHeight) / 2;
  const textLeft = centerX - textWidth(options.typography.wordmark, capHeight) / 2;
  const baselineY = top + emblemHeight * (1 + STACKED_GAP_RATIO) + capHeight;
  return combine(
    toneEmblem(options, emblemLeft, top, emblemHeight),
    wordmarkArt({ ...options, x: textLeft, baselineY, capHeight }),
  );
}

/** Master cap height of the standalone wordmark file, in SVG units. */
const WORDMARK_FILE_CAP_HEIGHT = 100;
/** Master emblem height of the standalone lockup files, in SVG units. */
const LOCKUP_FILE_EMBLEM_HEIGHT = 200;
/** Anti-aliasing margin inside every file, relative to the master height. */
const FILE_MARGIN_RATIO = 0.06;

const TONE_TITLES: Readonly<Record<LockupTone, string>> = {
  dark: '',
  light: ' (for light backgrounds)',
  mono: ' (monochrome)',
};

export function wordmarkSvg(typography: BrandTypography, tone: LockupTone): string {
  const capHeight = WORDMARK_FILE_CAP_HEIGHT;
  const margin = capHeight * FILE_MARGIN_RATIO;
  return svgDocument({
    width: textWidth(typography.wordmark, capHeight) + 2 * margin,
    height: capHeight + 2 * margin,
    title: `JAVELIN wordmark${TONE_TITLES[tone]}`,
    content: wordmarkArt({
      id: 'wordmark',
      typography,
      tone,
      x: margin,
      baselineY: margin + capHeight,
      capHeight,
    }),
  });
}

export function horizontalLockupSvg(typography: BrandTypography, tone: LockupTone): string {
  const emblemHeight = LOCKUP_FILE_EMBLEM_HEIGHT;
  const margin = emblemHeight * FILE_MARGIN_RATIO;
  const box = horizontalLockupBox(typography, emblemHeight);
  return svgDocument({
    width: box.width + 2 * margin,
    height: box.height + 2 * margin,
    title: `JAVELIN lockup${TONE_TITLES[tone]}`,
    content: horizontalLockup({
      id: 'lockup',
      typography,
      tone,
      left: margin,
      top: margin,
      emblemHeight,
    }),
  });
}

export function stackedLockupSvg(typography: BrandTypography, tone: LockupTone): string {
  const emblemHeight = LOCKUP_FILE_EMBLEM_HEIGHT;
  const margin = emblemHeight * FILE_MARGIN_RATIO;
  const box = stackedLockupBox(typography, emblemHeight);
  return svgDocument({
    width: box.width + 2 * margin,
    height: box.height + 2 * margin,
    title: `JAVELIN stacked lockup${TONE_TITLES[tone]}`,
    content: stackedLockup({
      id: 'lockup',
      typography,
      tone,
      centerX: margin + box.width / 2,
      top: margin,
      emblemHeight,
    }),
  });
}
