/**
 * The committed PNGs are what gets uploaded to Discord, so they must match
 * their SVG sources. The check is perceptual, not byte-for-byte (zlib output
 * and float rounding may differ between machines): each committed PNG is
 * decoded, box-reduced in linear light to about 32 px, and compared with a
 * fresh render of the committed SVG at that size.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { packagePath } from '../scripts/lib/paths';
import { encodePng, type RgbaImage } from '../scripts/lib/png';
import { decodePng, downsample, rasterize, renderSvg } from '../scripts/lib/raster';
import { BRAND_ASSETS, BRAND_ASSET_IDS, type BrandRaster } from './manifest';
import { FIRST_RELEASE_PLATE_FACE } from './svg/first-release.fixture';
import { ALUMINIUM_PLATE, plateArt, type PlateLayout, type PlateMaterial } from './svg/plates';
import { PADDED_PLATE_LAYOUT, PLATE_CANVAS } from './svg/icons';
import { svgDocument } from './svg/xml';

/** Rasters are compared once reduced to at least this many pixels on the long side. */
const COMPARISON_SIZE = 32;
/**
 * The fresh render is supersampled this much per axis, so thin strokes and the
 * aliased brushing noise average out as they do in the full-size PNG (at 8× a
 * synced pair still differs by up to 22 levels; at 32×, by at most 5).
 */
const REFERENCE_SUPERSAMPLE = 32;
/** Largest allowed difference of any premultiplied channel, 8-bit levels. */
const MAX_CHANNEL_DELTA = 12;
/** Largest allowed mean difference over all channels, 8-bit levels. */
const MAX_MEAN_DELTA = 1.5;
const RGBA_CHANNELS = 4;
const ALPHA = 3;
const CHANNEL_MAX = 255;
/** Stale-PNG scenarios, rendered at 128 px: an emblem 7% smaller… */
const STALE_SCALE = 0.93;
const STALE_SIZE = 128;
/** …or the plate face of the first release, about 14 levels lighter. */
const STALE_FACE: PlateMaterial['face'] = FIRST_RELEASE_PLATE_FACE;

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/** Largest reduction factor that divides both sides and keeps the long side ≥ COMPARISON_SIZE. */
function comparisonFactor(width: number, height: number): number {
  const common = greatestCommonDivisor(width, height);
  const longSide = Math.max(width, height);
  let factor = 1;
  for (let candidate = 1; candidate <= common; candidate += 1) {
    if (common % candidate === 0 && longSide / candidate >= COMPARISON_SIZE) factor = candidate;
  }
  return factor;
}

interface Difference {
  readonly max: number;
  readonly mean: number;
}

/** Channel differences with colour weighted by coverage, so invisible pixels do not count. */
function difference(a: RgbaImage, b: RgbaImage): Difference {
  expect({ width: a.width, height: a.height }).toEqual({ width: b.width, height: b.height });
  let max = 0;
  let total = 0;
  for (let pixel = 0; pixel < a.data.length; pixel += RGBA_CHANNELS) {
    const alphaA = (a.data[pixel + ALPHA] ?? 0) / CHANNEL_MAX;
    const alphaB = (b.data[pixel + ALPHA] ?? 0) / CHANNEL_MAX;
    for (let channel = 0; channel < RGBA_CHANNELS; channel += 1) {
      const weightA = channel === ALPHA ? 1 : alphaA;
      const weightB = channel === ALPHA ? 1 : alphaB;
      const delta = Math.abs(
        (a.data[pixel + channel] ?? 0) * weightA - (b.data[pixel + channel] ?? 0) * weightB,
      );
      max = Math.max(max, delta);
      total += delta;
    }
  }
  return { max, mean: total / a.data.length };
}

/** Compares a PNG with a fresh render of an SVG, both reduced to the comparison size. */
function pngVersusSvg(png: Buffer, svg: string, raster: BrandRaster): Difference {
  const factor = comparisonFactor(raster.width, raster.height);
  const committed = downsample(decodePng(png), factor);
  const width = raster.width / factor;
  const fresh = downsample(renderSvg(svg, width * REFERENCE_SUPERSAMPLE), REFERENCE_SUPERSAMPLE);
  return difference(committed, fresh);
}

const rasters = BRAND_ASSET_IDS.flatMap((id) =>
  BRAND_ASSETS[id].rasters.map((raster) => [raster.path, id, raster] as const),
);

describe('committed PNGs', () => {
  it('reduce every raster to a comparable size', () => {
    for (const [, , raster] of rasters) {
      const factor = comparisonFactor(raster.width, raster.height);
      expect(raster.width % factor).toBe(0);
      expect(raster.height % factor).toBe(0);
      expect(Math.max(raster.width, raster.height) / factor).toBeGreaterThanOrEqual(
        Math.min(COMPARISON_SIZE, Math.max(raster.width, raster.height)),
      );
    }
  });

  it.each(rasters)('%s matches its SVG source (re-run `pnpm render`)', (path, id, raster) => {
    const png = readFileSync(packagePath(path));
    const svg = readFileSync(packagePath(BRAND_ASSETS[id].svg), 'utf8');
    const delta = pngVersusSvg(png, svg, raster);
    expect(delta.max).toBeLessThanOrEqual(MAX_CHANNEL_DELTA);
    expect(delta.mean).toBeLessThanOrEqual(MAX_MEAN_DELTA);
  });

  describe('BREAK: a merge that keeps one branch’s PNG and the other’s SVG', () => {
    const raster = { path: 'stale.png', width: STALE_SIZE, height: STALE_SIZE };
    const committedSvg = readFileSync(packagePath(BRAND_ASSETS['server-icon'].svg), 'utf8');
    const iconPng = (layout: PlateLayout, material: PlateMaterial): Buffer =>
      encodePng(
        rasterize(
          svgDocument({
            width: PLATE_CANVAS,
            height: PLATE_CANVAS,
            title: 'stale',
            content: plateArt('stale', layout, material),
          }),
          STALE_SIZE,
          STALE_SIZE,
        ),
      );

    it('passes an up-to-date render', () => {
      const fresh = pngVersusSvg(
        iconPng(PADDED_PLATE_LAYOUT, ALUMINIUM_PLATE),
        committedSvg,
        raster,
      );
      expect(fresh.max).toBeLessThanOrEqual(MAX_CHANNEL_DELTA);
      expect(fresh.mean).toBeLessThanOrEqual(MAX_MEAN_DELTA);
    });

    it('flags a PNG whose emblem geometry changed', () => {
      const layout = {
        ...PADDED_PLATE_LAYOUT,
        emblemRadius: PADDED_PLATE_LAYOUT.emblemRadius * STALE_SCALE,
      };
      const stale = pngVersusSvg(iconPng(layout, ALUMINIUM_PLATE), committedSvg, raster);
      expect(stale.max).toBeGreaterThan(MAX_CHANNEL_DELTA);
    });

    it('flags a PNG whose metal tones changed', () => {
      const material = { ...ALUMINIUM_PLATE, face: STALE_FACE };
      const stale = pngVersusSvg(iconPng(PADDED_PLATE_LAYOUT, material), committedSvg, raster);
      expect(stale.mean).toBeGreaterThan(MAX_MEAN_DELTA);
    });
  });
});
