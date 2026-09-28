import { mix } from './color';

/**
 * Geometry and shading of the CSS 3D tablet, ported from the prototype
 * (`buildLayers` in Home, the `layers` loop in Main).
 *
 * The tablet is a stack of discs, each pushed along Z with `translateZ` inside a
 * `transform-style: preserve-3d` parent. All distances here are fractions of the tablet
 * diameter so the component can be sized with a single CSS length (`--tab-s`).
 */

export interface TabletPalette {
  /** Underside layer. */
  bottom: string;
  /** Middle layer (the product's signature color). */
  mid: string;
  /** Tint of the white top layer. */
  blush: string;
}

export interface TabletLayer {
  /** Position through the tablet: 0 is the underside, 1 the top face. */
  t: number;
  /** `translateZ` as a fraction of the diameter. */
  z: number;
  /** Disc scale; below 1 near the faces, which rounds off the domes. */
  scale: number;
  background: string;
}

export interface TabletGeometry {
  layers: TabletLayer[];
  /** `translateZ` of the top face disc as a fraction of the diameter (bottom face is negative). */
  faceZ: number;
  faceTop: string;
  faceBottom: string;
}

/** Tablet thickness relative to its diameter (`T = size / 6`). */
export const THICKNESS = 1 / 6;
/** Face discs are scaled like the outermost layers. */
export const FACE_SCALE = 0.81;
/** The two soft seams between the three pressed layers. */
export const SEAMS = [0.34, 0.66] as const;

const FLAT_BAND = 0.42;
const SEAM_WIDTH = 0.035;
const SEAM_LINE = 0.012;

/** The top layer's white, slightly tinted with the product's blush. */
export function tabletWhite(palette: TabletPalette): string {
  return mix(palette.blush, '#ffffff', 0.55);
}

function bandColor(palette: TabletPalette, white: string, t: number): string {
  const [low, high] = SEAMS;
  if (t < low - SEAM_WIDTH) return palette.bottom;
  if (t < low + SEAM_WIDTH) {
    return mix(palette.bottom, palette.mid, (t - (low - SEAM_WIDTH)) / (2 * SEAM_WIDTH));
  }
  if (t < high - SEAM_WIDTH) return palette.mid;
  if (t < high + SEAM_WIDTH) {
    return mix(palette.mid, white, (t - (high - SEAM_WIDTH)) / (2 * SEAM_WIDTH));
  }
  return white;
}

/** Disc scale at depth `t`: flat through the middle, domed towards both faces. */
export function layerScale(t: number): number {
  const a = Math.abs(t - 0.5) * 2;
  const d = a <= FLAT_BAND ? 0 : (a - FLAT_BAND) / (1 - FLAT_BAND);
  return 1 - 0.19 * Math.pow(d, 1.8);
}

export function buildTablet(palette: TabletPalette, count: number): TabletGeometry {
  if (!Number.isInteger(count) || count < 2) {
    throw new Error(`A tablet needs at least two layers, got ${count}`);
  }
  const white = tabletWhite(palette);
  const layers: TabletLayer[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    let color = bandColor(palette, white, t);
    // A faint darker line where two pressed layers meet.
    if (SEAMS.some((seam) => Math.abs(t - seam) < SEAM_LINE)) color = mix(color, '#1a0820', 0.12);
    const isWhite = t >= SEAMS[1] + SEAM_WIDTH;
    const dark = isWhite ? mix(color, '#5a4a70', 0.3) : mix(color, '#10000c', 0.38);
    const lite = mix(color, '#ffffff', isWhite ? 0.6 : 0.3);
    layers.push({
      t,
      z: (t - 0.5) * THICKNESS,
      scale: layerScale(t),
      background: `radial-gradient(circle at 36% 28%, ${lite}, ${color} 52%, ${dark} 100%)`,
    });
  }
  return {
    layers,
    faceZ: THICKNESS / 2,
    faceTop:
      'radial-gradient(circle at 34% 26%, #ffffff 0%, #fefcfd 28%, ' +
      `${mix(white, '#ffffff', 0.4)} 62%, ${mix(white, '#6a5a80', 0.14)} 100%)`,
    faceBottom:
      `radial-gradient(circle at 45% 40%, ${mix(palette.bottom, '#ffffff', 0.08)}, ` +
      `${mix(palette.bottom, '#000000', 0.2)} 70%, ${mix(palette.bottom, '#000000', 0.45)})`,
  };
}

/** The flat top face used for 2D tablets (finder, cards, rail, blister). */
export function flatFace(palette: TabletPalette): string {
  const white = tabletWhite(palette);
  return (
    `radial-gradient(circle at 34% 28%, #ffffff, ${mix(white, '#ffffff', 0.4)} 60%, ` +
    `${mix(white, '#6a5a80', 0.16)})`
  );
}

/** Stacked box-shadows that fake the tablet's side for flat faces. */
export function flatEdge(
  palette: TabletPalette,
  edge: number,
  drop: string,
  ring = 'rgba(255,255,255,0.7)',
): string {
  return `inset 0 0 0 1.5px ${ring}, 0 ${edge}px 0 ${palette.mid}, 0 ${edge * 2}px 0 ${palette.bottom}, ${drop}`;
}
