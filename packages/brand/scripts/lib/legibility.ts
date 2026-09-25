/**
 * Small-size legibility of the emblem on an icon plate.
 *
 * The icon is rendered at the target size next to the same plate without the
 * emblem (same layout and material, so pixel-identical wherever the emblem and
 * its relief do not reach), and next to coverage masks of the emblem's lit
 * (left) and shaded (right) facets. For every pixel that one half dominates, the contrast is how
 * far the emblem moves that pixel away from the bare plate, in 8-bit luma.
 * The worst pixel of each half is what a viewer has to recognise the mark by.
 */
import { EMBLEM_LEFT_FACETS, EMBLEM_RIGHT_FACETS } from '../../src/emblem';
import { emblemFacets } from '../../src/svg/emblem-art';
import type { PlateIconSpec } from '../../src/svg/icons';
import { plateEmblemPlacement, plateSurfaceArt, type PlateLayout } from '../../src/svg/plates';
import { svgDocument, type Fragment } from '../../src/svg/xml';
import type { RgbaImage } from './png';
import { rasterize } from './raster';

const RGBA_CHANNELS = 4;
const ALPHA = 3;
const CHANNEL_MAX = 255;
/** Rec. 709 luma weights, applied to 8-bit sRGB values. */
const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;
const MASK_FILL = '#FFFFFF';

/**
 * A pixel belongs to one half of the emblem when that half covers at least
 * this much of it and at least twice as much as the other half.
 */
export const DOMINANT_COVERAGE = 0.3;
const DOMINANCE_RATIO = 2;

export interface HalfContrast {
  /** Smallest |luma(icon) − luma(bare plate)| over the pixels this half dominates. */
  readonly min: number;
  /** Mean of the same, for reporting. */
  readonly mean: number;
  /** How many pixels this half dominates at this size. */
  readonly pixels: number;
}

export interface EmblemContrast {
  readonly size: number;
  readonly lit: HalfContrast;
  readonly shade: HalfContrast;
}

function luma(image: RgbaImage, index: number): number {
  const offset = index * RGBA_CHANNELS;
  return LUMA_WEIGHTS.reduce(
    (sum, weight, channel) => sum + weight * (image.data[offset + channel] ?? 0),
    0,
  );
}

function coverage(mask: RgbaImage, index: number): number {
  return (mask.data[index * RGBA_CHANNELS + ALPHA] ?? 0) / CHANNEL_MAX;
}

function summarize(contrasts: readonly number[]): HalfContrast {
  if (contrasts.length === 0) return { min: 0, mean: 0, pixels: 0 };
  const total = contrasts.reduce((sum, value) => sum + value, 0);
  return { min: Math.min(...contrasts), mean: total / contrasts.length, pixels: contrasts.length };
}

function plateDocument(layout: PlateLayout, content: Fragment): string {
  return svgDocument({ width: layout.size, height: layout.size, title: 'measurement', content });
}

/**
 * Measures the emblem against its plate in a `size`×`size` render of `iconSvg`,
 * an icon built from `spec` (its layout and material).
 */
export function plateEmblemContrast(
  iconSvg: string,
  spec: PlateIconSpec,
  size: number,
): EmblemContrast {
  const { layout, material } = spec;
  const placement = plateEmblemPlacement(layout);
  const render = (svg: string): RgbaImage => rasterize(svg, size, size);
  const icon = render(iconSvg);
  const bare = render(plateDocument(layout, plateSurfaceArt('bare', layout, material)));
  const lit = render(plateDocument(layout, emblemFacets(EMBLEM_LEFT_FACETS, placement, MASK_FILL)));
  const shade = render(
    plateDocument(layout, emblemFacets(EMBLEM_RIGHT_FACETS, placement, MASK_FILL)),
  );
  const litContrasts: number[] = [];
  const shadeContrasts: number[] = [];
  for (let index = 0; index < size * size; index += 1) {
    const litCover = coverage(lit, index);
    const shadeCover = coverage(shade, index);
    const contrast = Math.abs(luma(icon, index) - luma(bare, index));
    if (litCover >= DOMINANT_COVERAGE && litCover >= DOMINANCE_RATIO * shadeCover) {
      litContrasts.push(contrast);
    } else if (shadeCover >= DOMINANT_COVERAGE && shadeCover >= DOMINANCE_RATIO * litCover) {
      shadeContrasts.push(contrast);
    }
  }
  return { size, lit: summarize(litContrasts), shade: summarize(shadeContrasts) };
}
