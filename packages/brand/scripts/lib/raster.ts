/**
 * Deterministic rasterization: resvg renders the SVG with system fonts
 * disabled (all type is outlined), optionally supersampled, then an exact box
 * filter in linear light produces each output size.
 */
import { Resvg } from '@resvg/resvg-js';
import { readPngHeader, type RgbaImage } from './png';

/** Supersampled renders aim for at least this many pixels on the long side. */
const SUPERSAMPLE_TARGET_PX = 2048;
const MAX_SUPERSAMPLE = 8;
const RGBA_CHANNELS = 4;
const ALPHA = 3;
const CHANNEL_MAX = 255;
/** Resolution of the linear→sRGB lookup table. */
const LINEAR_LUT_SIZE = 4096;
/** Resvg `shapeRendering: geometricPrecision`. */
const GEOMETRIC_PRECISION = 2;

/** sRGB transfer function constants (IEC 61966-2-1). */
const SRGB_LINEAR_THRESHOLD = 0.04045;
const LINEAR_SRGB_THRESHOLD = 0.0031308;
const SRGB_LINEAR_SLOPE = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_GAMMA = 2.4;

function srgbToLinear(value: number): number {
  return value <= SRGB_LINEAR_THRESHOLD
    ? value / SRGB_LINEAR_SLOPE
    : ((value + SRGB_OFFSET) / (1 + SRGB_OFFSET)) ** SRGB_GAMMA;
}

function linearToSrgb(value: number): number {
  return value <= LINEAR_SRGB_THRESHOLD
    ? value * SRGB_LINEAR_SLOPE
    : (1 + SRGB_OFFSET) * value ** (1 / SRGB_GAMMA) - SRGB_OFFSET;
}

const TO_LINEAR = Float64Array.from({ length: CHANNEL_MAX + 1 }, (_, i) =>
  srgbToLinear(i / CHANNEL_MAX),
);
const TO_SRGB = Uint8Array.from({ length: LINEAR_LUT_SIZE + 1 }, (_, i) =>
  Math.round(linearToSrgb(i / LINEAR_LUT_SIZE) * CHANNEL_MAX),
);

/** Supersampling factor for a render whose largest output is `width`×`height`. */
export function supersampleFactor(width: number, height: number): number {
  const factor = Math.floor(SUPERSAMPLE_TARGET_PX / Math.max(width, height));
  return Math.min(MAX_SUPERSAMPLE, Math.max(1, factor));
}

/** A premultiplied RGBA render straight from resvg. */
export interface PremultipliedImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/**
 * Decodes a PNG by letting resvg draw it 1:1, so the result is premultiplied
 * like `renderSvg` output and can go through `downsample`.
 */
export function decodePng(png: Buffer): PremultipliedImage {
  const { width, height } = readPngHeader(png);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image width="${width}" height="${height}" image-rendering="optimizeSpeed" href="data:image/png;base64,${png.toString('base64')}"/></svg>`;
  const rendered = new Resvg(svg, { font: { loadSystemFonts: false }, logLevel: 'error' }).render();
  return { width: rendered.width, height: rendered.height, data: rendered.pixels };
}

/** Renders an SVG so its width is exactly `width` px. */
export function renderSvg(svg: string, width: number): PremultipliedImage {
  const rendered = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false },
    shapeRendering: GEOMETRIC_PRECISION,
    logLevel: 'error',
  }).render();
  return { width: rendered.width, height: rendered.height, data: rendered.pixels };
}

/**
 * Exact box downsample by an integer factor, averaging in linear light with
 * premultiplied alpha, returning straight (unpremultiplied) sRGB RGBA.
 */
export function downsample(source: PremultipliedImage, factor: number): RgbaImage {
  if (!Number.isInteger(factor) || factor < 1)
    throw new RangeError(`Invalid downsample factor ${factor}.`);
  if (source.width % factor !== 0 || source.height % factor !== 0) {
    throw new RangeError(`${source.width}x${source.height} is not divisible by ${factor}.`);
  }
  const width = source.width / factor;
  const height = source.height / factor;
  const samples = factor * factor;
  const out = new Uint8Array(width * height * RGBA_CHANNELS);
  const sum = new Float64Array(RGBA_CHANNELS);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      sum.fill(0);
      for (let sy = 0; sy < factor; sy += 1) {
        let index = ((y * factor + sy) * source.width + x * factor) * RGBA_CHANNELS;
        for (let sx = 0; sx < factor; sx += 1, index += RGBA_CHANNELS) {
          const alpha = source.data[index + ALPHA] ?? 0;
          if (alpha === 0) continue;
          const coverage = alpha / CHANNEL_MAX;
          for (let c = 0; c < ALPHA; c += 1) {
            const straight = Math.min(
              CHANNEL_MAX,
              Math.round(((source.data[index + c] ?? 0) * CHANNEL_MAX) / alpha),
            );
            sum[c] = (sum[c] ?? 0) + (TO_LINEAR[straight] ?? 0) * coverage;
          }
          sum[ALPHA] = (sum[ALPHA] ?? 0) + coverage;
        }
      }
      const target = (y * width + x) * RGBA_CHANNELS;
      const totalCoverage = sum[ALPHA] ?? 0;
      if (totalCoverage === 0) continue;
      for (let c = 0; c < ALPHA; c += 1) {
        const linear = Math.min(1, (sum[c] ?? 0) / totalCoverage);
        out[target + c] = TO_SRGB[Math.round(linear * LINEAR_LUT_SIZE)] ?? 0;
      }
      out[target + ALPHA] = Math.round((totalCoverage / samples) * CHANNEL_MAX);
    }
  }
  return { width, height, data: out };
}

/** Converts a render to straight alpha at its own size (a 1× box filter). */
export function toStraightAlpha(source: PremultipliedImage): RgbaImage {
  return downsample(source, 1);
}

/** Renders one output size, supersampled where affordable. */
export function rasterize(svg: string, width: number, height: number): RgbaImage {
  const factor = supersampleFactor(width, height);
  const master = renderSvg(svg, width * factor);
  if (master.height !== height * factor) {
    throw new RangeError(
      `SVG renders ${master.width}x${master.height}, expected ${width}x${height} (x${factor}).`,
    );
  }
  return downsample(master, factor);
}

/**
 * Renders several sizes of one SVG from a single supersampled master when the
 * sizes divide it evenly (so a 1024 icon and its 128 reduction match exactly),
 * falling back to separate renders otherwise.
 */
export function rasterizeSizes(
  svg: string,
  sizes: readonly { readonly width: number; readonly height: number }[],
): RgbaImage[] {
  const [first] = sizes;
  if (!first) return [];
  const largest = sizes.reduce((a, b) => (b.width > a.width ? b : a), first);
  const factor = supersampleFactor(largest.width, largest.height);
  const master = renderSvg(svg, largest.width * factor);
  return sizes.map((size) => {
    const ratio = master.width / size.width;
    const evenly = Number.isInteger(ratio) && master.height === size.height * ratio;
    return evenly ? downsample(master, ratio) : rasterize(svg, size.width, size.height);
  });
}
