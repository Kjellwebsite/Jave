/**
 * Paint servers and filters shared by every asset: gradients, drop shadows and
 * the brushed-metal grain.
 */
import { el, fmt, fmtScale } from './xml';

export interface GradientStop {
  /** 0..1 along the gradient vector. */
  readonly offset: number;
  readonly color: string;
  /** 0..1; omitted means opaque. */
  readonly opacity?: number;
}

export interface GradientVector {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** `userSpaceOnUse` coordinates, or fractions of the shape's bounding box. */
  readonly units: 'userSpaceOnUse' | 'objectBoundingBox';
}

/** Top-to-bottom across the painted shape. */
export const VERTICAL: GradientVector = { x1: 0, y1: 0, x2: 0, y2: 1, units: 'objectBoundingBox' };
/** Top-left to bottom-right across the painted shape (light from the top-left). */
export const DIAGONAL: GradientVector = { x1: 0, y1: 0, x2: 1, y2: 1, units: 'objectBoundingBox' };

function stopElements(stops: readonly GradientStop[]): string[] {
  return stops.map((stop) =>
    el('stop', {
      offset: stop.offset,
      'stop-color': stop.color,
      'stop-opacity': stop.opacity,
    }),
  );
}

export function linearGradient(
  id: string,
  vector: GradientVector,
  stops: readonly GradientStop[],
): string {
  return el(
    'linearGradient',
    {
      id,
      x1: vector.x1,
      y1: vector.y1,
      x2: vector.x2,
      y2: vector.y2,
      gradientUnits: vector.units,
    },
    ...stopElements(stops),
  );
}

/** Two-stop gradient between `from` and `to`. */
export function ramp(from: string, to: string): GradientStop[] {
  return [
    { offset: 0, color: from },
    { offset: 1, color: to },
  ];
}

export interface ShadowLayer {
  /** Blur radius (standard deviation) in user units. */
  readonly blur: number;
  readonly offsetY: number;
  readonly opacity: number;
}

/**
 * Casts one or more soft shadows of the painted shape. The shape itself is not
 * drawn — paint the filtered element with any opaque fill beneath the art.
 */
export function shadowFilter(
  id: string,
  color: string,
  layers: readonly ShadowLayer[],
  marginRatio: number,
): string {
  const primitives = layers.flatMap((layer, index) => [
    el('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: layer.blur, result: `blur${index}` }),
    el('feOffset', { in: `blur${index}`, dy: layer.offsetY, result: `offset${index}` }),
    el('feFlood', {
      'flood-color': color,
      'flood-opacity': layer.opacity,
      result: `flood${index}`,
    }),
    el('feComposite', {
      in: `flood${index}`,
      in2: `offset${index}`,
      operator: 'in',
      result: `shadow${index}`,
    }),
  ]);
  const merge = el(
    'feMerge',
    {},
    ...layers.map((_, index) => el('feMergeNode', { in: `shadow${index}` })),
  );
  return el(
    'filter',
    {
      id,
      x: fmt(-marginRatio),
      y: fmt(-marginRatio),
      width: fmt(1 + 2 * marginRatio),
      height: fmt(1 + 2 * marginRatio),
      'color-interpolation-filters': 'sRGB',
    },
    ...primitives,
    merge,
  );
}

export interface GrainOptions {
  /**
   * Turbulence frequency per axis. A strongly anisotropic pair (very low x,
   * high y) stretches the noise into horizontal brushing streaks.
   */
  readonly baseFrequency: { readonly x: number; readonly y: number };
  readonly octaves: number;
  readonly seed: number;
  /** How strongly the noise is split into bright and dark streaks (> 1). */
  readonly contrast: number;
}

/**
 * The brand's brushing texture: fine, long horizontal streaks. The x frequency
 * is tiny (streaks run far) and the y frequency high (they are thin), so the
 * noise reads as metal drawn across an abrasive. Add a seed per surface.
 */
export const BRUSHED_METAL_GRAIN: Omit<GrainOptions, 'seed'> = {
  baseFrequency: { x: 0.0025, y: 1.4 },
  octaves: 3,
  contrast: 6,
};

/** Noise of fractal turbulence sits around this value; streaks are measured from it. */
const NOISE_MIDPOINT = 0.5;

/**
 * Brushed-metal grain: horizontal streaks, half lighter and half darker than
 * the surface, clipped to the filtered shape. Apply to a shape with an opaque
 * fill and control strength with the element's opacity.
 */
export function brushedGrainFilter(id: string, options: GrainOptions): string {
  const gain = options.contrast;
  const bias = NOISE_MIDPOINT * gain;
  const light = `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${fmt(gain)} 0 0 0 ${fmt(-bias)}`;
  const dark = `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${fmt(-gain)} 0 0 0 ${fmt(bias)}`;
  return el(
    'filter',
    {
      id,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      filterUnits: 'objectBoundingBox',
      'color-interpolation-filters': 'sRGB',
    },
    el('feTurbulence', {
      type: 'fractalNoise',
      baseFrequency: `${fmtScale(options.baseFrequency.x)} ${fmtScale(options.baseFrequency.y)}`,
      numOctaves: options.octaves,
      seed: options.seed,
      stitchTiles: 'noStitch',
      result: 'noise',
    }),
    el('feColorMatrix', { in: 'noise', type: 'matrix', values: light, result: 'light' }),
    el('feColorMatrix', { in: 'noise', type: 'matrix', values: dark, result: 'dark' }),
    el(
      'feMerge',
      { result: 'streaks' },
      el('feMergeNode', { in: 'dark' }),
      el('feMergeNode', { in: 'light' }),
    ),
    el('feComposite', { in: 'streaks', in2: 'SourceAlpha', operator: 'in' }),
  );
}

export function clipPath(id: string, ...shapes: readonly string[]): string {
  return el('clipPath', { id }, ...shapes);
}
