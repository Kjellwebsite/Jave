import { describe, expect, it } from 'vitest';
import { mix, parseHex, toHex, withAlpha } from './color';
import { buildTablet, FACE_SCALE, flatEdge, layerScale, SEAMS, THICKNESS } from './tablet';

const CALM = { bottom: '#c4122f', mid: '#e0218a', blush: '#fbe1ee' };

describe('color', () => {
  it('parses and prints hex colors', () => {
    expect(parseHex('#1c1548')).toEqual([28, 21, 72]);
    expect(toHex([28, 21, 72])).toBe('#1c1548');
    expect(toHex([-4, 300, 12.6])).toBe('#00ff0d');
  });

  it('mixes like the prototype', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    // The white of the Calm tablet: mix(blush, white, 0.55).
    expect(mix('#fbe1ee', '#ffffff', 0.55)).toBe('#fdf2f7');
  });

  it('adds an alpha byte', () => {
    expect(withAlpha('#1c1548', 0.18)).toBe('#1c15482e');
  });

  it('rejects anything but #rrggbb', () => {
    expect(() => parseHex('red')).toThrow();
    expect(() => parseHex('#fff')).toThrow();
  });
});

describe('tablet geometry', () => {
  it('stacks the discs through the thickness, bottom to top', () => {
    const { layers, faceZ } = buildTablet(CALM, 48);
    expect(layers).toHaveLength(48);
    expect(layers[0]!.z).toBeCloseTo(-THICKNESS / 2);
    expect(layers.at(-1)!.z).toBeCloseTo(THICKNESS / 2);
    expect(faceZ).toBeCloseTo(THICKNESS / 2);
    for (let i = 1; i < layers.length; i++) expect(layers[i]!.z).toBeGreaterThan(layers[i - 1]!.z);
  });

  it('domes the edges to the face scale and keeps the middle flat', () => {
    expect(layerScale(0)).toBeCloseTo(FACE_SCALE);
    expect(layerScale(1)).toBeCloseTo(FACE_SCALE);
    expect(layerScale(0.5)).toBe(1);
    expect(layerScale(0.3)).toBe(1);
    expect(layerScale(0.15)).toBeLessThan(1);
  });

  it('colors the three pressed layers with soft seams', () => {
    const { layers } = buildTablet(CALM, 101);
    const at = (t: number) => layers.find((l) => Math.abs(l.t - t) < 1e-9)!.background;
    expect(at(0.1)).toContain(CALM.bottom);
    expect(at(0.5)).toContain(CALM.mid);
    expect(at(0.9)).toContain('#fdf2f7');
    // A blend, neither pure color, right at the lower seam.
    expect(at(SEAMS[0])).not.toContain(CALM.bottom);
    expect(at(SEAMS[0])).not.toContain(`${CALM.mid} 52%`);
  });

  it('needs at least two layers', () => {
    expect(() => buildTablet(CALM, 1)).toThrow();
  });

  it('builds the flat edge shadow from the palette', () => {
    expect(flatEdge(CALM, 4, '0 8px 8px black')).toBe(
      'inset 0 0 0 1.5px rgba(255,255,255,0.7), 0 4px 0 #e0218a, 0 8px 0 #c4122f, 0 8px 8px black',
    );
  });
});
