import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { BRAND_MOTTO, BRAND_MOTTO_LINES, BRAND_NAME } from '../../src/copy';
import {
  MOTTO_FONT_FILE,
  WORDMARK_FONT_FILE,
  fontPath,
  loadBrandTypography,
} from './brand-typography';
import { loadFont, outlineText } from './outline-text';
import { packagePath } from './paths';
import { encodePng, readPngHeader, type RgbaImage } from './png';
import { decodePng, downsample, rasterizeSizes, supersampleFactor } from './raster';

function image(width: number, height: number, pixels: readonly number[][]): RgbaImage {
  return { width, height, data: Uint8Array.from(pixels.flat()) };
}

/** Decodes a PNG 1:1 with resvg; returns premultiplied RGBA. */
function decodeWithResvg(png: Buffer, width: number, height: number): number[] {
  const decoded = decodePng(png);
  expect({ width: decoded.width, height: decoded.height }).toEqual({ width, height });
  return [...decoded.data];
}

describe('png encoder', () => {
  it('writes a valid RGBA PNG that decodes to the same pixels', () => {
    const source = image(3, 2, [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 0],
      [10, 20, 30, 255],
      [200, 100, 50, 255],
    ]);
    const png = encodePng(source);
    expect(readPngHeader(png)).toEqual({ width: 3, height: 2, hasAlpha: true });
    const decoded = decodeWithResvg(png, 3, 2);
    // resvg hands back premultiplied pixels: the fully transparent one becomes all zeros.
    expect(decoded).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0, 10, 20, 30, 255, 200, 100, 50,
      255,
    ]);
  });

  it('drops the alpha channel when every pixel is opaque', () => {
    const png = encodePng(
      image(2, 1, [
        [1, 2, 3, 255],
        [4, 5, 6, 255],
      ]),
    );
    expect(readPngHeader(png).hasAlpha).toBe(false);
    expect(decodeWithResvg(png, 2, 1)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });

  it('is deterministic', () => {
    const source = image(2, 2, [
      [9, 8, 7, 255],
      [6, 5, 4, 128],
      [3, 2, 1, 0],
      [0, 0, 0, 255],
    ]);
    expect(encodePng(source).equals(encodePng(source))).toBe(true);
  });

  it('BREAK: rejects malformed input', () => {
    expect(() => encodePng({ width: 2, height: 2, data: new Uint8Array(3) })).toThrow(RangeError);
    expect(() => encodePng({ width: 0, height: 1, data: new Uint8Array(0) })).toThrow(RangeError);
    expect(() => readPngHeader(Buffer.from('GIF89a-not-a-png-at-all-000000000000'))).toThrow(
      TypeError,
    );
    expect(() => readPngHeader(new Uint8Array(4))).toThrow(TypeError);
  });
});

describe('paths', () => {
  it('BREAK: never resolves outside the brand package', () => {
    expect(packagePath('assets/png/favicon-16.png')).toMatch(
      /packages\/brand\/assets\/png\/favicon-16\.png$/,
    );
    for (const hostile of ['../../package.json', 'assets/../../x', '/etc/passwd']) {
      expect(() => packagePath(hostile)).toThrow(RangeError);
    }
  });
});

describe('rasterizer', () => {
  it('supersamples small outputs and caps large ones', () => {
    expect(supersampleFactor(1024, 1024)).toBe(2);
    expect(supersampleFactor(64, 64)).toBe(8);
    expect(supersampleFactor(1920, 1080)).toBe(1);
    expect(supersampleFactor(4096, 4096)).toBe(1);
  });

  it('averages in linear light with premultiplied alpha', () => {
    const checker = [0, 0, 0, 255, 255, 255, 255, 255];
    const blackAndWhite = { width: 2, height: 2, data: Uint8Array.from([...checker, ...checker]) };
    const mid = downsample(blackAndWhite, 2);
    // Linear 0.5 is sRGB ~188, not the naive 128.
    expect([...mid.data]).toEqual([188, 188, 188, 255]);

    const redOverTransparent = {
      width: 2,
      height: 2,
      data: Uint8Array.from([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    };
    expect([...downsample(redOverTransparent, 2).data]).toEqual([255, 0, 0, 64]);
  });

  it('BREAK: refuses uneven or invalid factors', () => {
    const tiny = { width: 3, height: 3, data: new Uint8Array(36) };
    expect(() => downsample(tiny, 2)).toThrow(RangeError);
    expect(() => downsample(tiny, 0)).toThrow(RangeError);
    expect(() => downsample(tiny, 1.5)).toThrow(RangeError);
  });

  it('renders every requested size from one master', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#737981"/></svg>';
    const [large, small, odd] = rasterizeSizes(svg, [
      { width: 64, height: 64 },
      { width: 16, height: 16 },
      { width: 48, height: 48 },
    ]);
    expect([large?.width, small?.width, odd?.width]).toEqual([64, 16, 48]);
    expect([...(small?.data.subarray(0, 4) ?? [])]).toEqual([0x73, 0x79, 0x81, 255]);
    expect(rasterizeSizes(svg, [])).toEqual([]);
  });
});

describe('outlined type', () => {
  const font = loadFont(fontPath(WORDMARK_FONT_FILE));

  it('outlines the brand strings with ink starting at x = 0', () => {
    const typography = loadBrandTypography();
    expect(typography.wordmark.text).toBe(BRAND_NAME);
    expect(typography.mottoLines.map((line) => line.text)).toEqual([...BRAND_MOTTO_LINES]);
    for (const outlined of [typography.wordmark, ...typography.mottoLines]) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="${outlined.d}"/></svg>`;
      const box = new Resvg(svg).getBBox();
      expect(box?.x).toBeCloseTo(0, 0);
      expect(box?.width).toBeCloseTo(outlined.width, 0);
      expect(outlined.capHeight).toBeGreaterThan(0);
    }
  });

  it('widens with tracking and is deterministic', () => {
    const tight = outlineText(font, 'JAVELIN', { trackingEm: 0 });
    const wide = outlineText(font, 'JAVELIN', { trackingEm: 0.2 });
    expect(wide.width - tight.width).toBeCloseTo(6 * 0.2 * 1000, 6);
    expect(outlineText(font, 'JAVELIN', { trackingEm: 0.2 })).toEqual(wide);
  });

  it('sets the motto lines to exactly the canonical motto', () => {
    expect(BRAND_MOTTO_LINES.join(' ')).toBe(BRAND_MOTTO);
  });

  it('uses the same committed font for the motto', () => {
    expect(() => loadFont(fontPath(MOTTO_FONT_FILE))).not.toThrow();
  });

  it('BREAK: refuses characters the font cannot draw, and empty text', () => {
    expect(() => outlineText(font, 'JAVELIN 中', { trackingEm: 0 })).toThrow(/no glyph/);
    expect(() => outlineText(font, '', { trackingEm: 0 })).toThrow(RangeError);
  });
});
