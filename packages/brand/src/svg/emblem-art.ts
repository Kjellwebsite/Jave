/**
 * Emblem renderings. Geometry always comes from `emblem.ts`; this module only
 * decides paint, placement and relief.
 */
import { BRAND_COLORS, METAL_TONES } from '../colors';
import { EMBLEM_LEFT_FACETS, EMBLEM_RIGHT_FACETS, EMBLEM_SILHOUETTE } from '../emblem';
import { EMBLEM_BOUNDS, EMBLEM_ENCLOSING_CIRCLE, EMBLEM_RIDGE_UNDERLAY } from '../emblem-metrics';
import type { Point } from '../geometry';
import {
  linearGradient,
  ramp,
  shadowFilter,
  type GradientStop,
  type GradientVector,
  type ShadowLayer,
} from './paint';
import { el, fragment, translate, translateScale, url, type Fragment } from './xml';

export interface EmblemFinish {
  /** Paint for the facets facing the light (left). */
  readonly light: readonly GradientStop[];
  /** Paint for the facets turned away (right). */
  readonly shade: readonly GradientStop[];
}

export const EMBLEM_FINISHES = {
  /** Two-tone metal for dark surfaces: white→chrome and aluminium→steel. */
  metallic: {
    light: ramp(BRAND_COLORS.white, BRAND_COLORS.chrome),
    shade: ramp(BRAND_COLORS.aluminium, BRAND_COLORS.steel),
  },
  /** Graphite and steel facets for light surfaces. */
  onLight: {
    light: ramp(BRAND_COLORS.steel, METAL_TONES.steelDeep),
    shade: ramp(METAL_TONES.graphiteLift, BRAND_COLORS.graphite),
  },
  /**
   * Polished chrome for sitting on brushed aluminium. Chrome mirrors its
   * surroundings, so the lit side is almost pure white and the shaded side
   * falls from deep steel to graphite: the mark reads against mid silver from
   * both sides, down to 16 px.
   */
  chrome: {
    light: ramp(BRAND_COLORS.white, METAL_TONES.aluminiumHighlight),
    shade: ramp(METAL_TONES.steelDeep, METAL_TONES.graphiteLift),
  },
} as const satisfies Record<string, EmblemFinish>;

/** Facet gradients run diagonally across the emblem, lit from the upper left. */
const FACET_VECTOR: GradientVector = {
  x1: EMBLEM_BOUNDS.minX,
  y1: EMBLEM_BOUNDS.minY,
  x2: EMBLEM_BOUNDS.maxX,
  y2: EMBLEM_BOUNDS.maxY,
  units: 'userSpaceOnUse',
};

/** Shadow filters get this much room around the emblem, relative to its size. */
const SHADOW_MARGIN_RATIO = 0.25;

/** Depth cues for an emblem set into a surface. Measurements are in output units. */
export interface EmblemRelief {
  readonly shadowColor: string;
  readonly shadows: readonly ShadowLayer[];
  /** A crisp contour that separates the emblem from a similar-toned surface. */
  readonly contour: { readonly color: string; readonly opacity: number; readonly width: number };
  /**
   * Light caught by the emblem's upper edges: the silhouette, shifted up by
   * `offsetY` (negative), peeking out above the facets. Sells the emboss.
   */
  readonly rimLight?: {
    readonly color: string;
    readonly opacity: number;
    readonly offsetY: number;
  };
}

export interface EmblemPlacement {
  /** Where the centre of the emblem's enclosing circle lands. */
  readonly center: Point;
  /** Radius of the emblem's enclosing circle in output units. */
  readonly radius: number;
}

export interface EmblemArtOptions {
  /** Unique prefix for gradient and filter ids within one document. */
  readonly id: string;
  readonly finish: EmblemFinish;
  /** Omit to draw in native emblem units (the 0..100 viewBox). */
  readonly placement?: EmblemPlacement;
  readonly relief?: EmblemRelief;
}

/** Rendered emblem width for a given rendered height (bounding box). */
export function emblemWidthForHeight(height: number): number {
  return (EMBLEM_BOUNDS.width * height) / EMBLEM_BOUNDS.height;
}

/** Places the emblem by its bounding box: top-left corner and height. */
export function placementInBox(left: number, top: number, height: number): EmblemPlacement {
  const scale = height / EMBLEM_BOUNDS.height;
  const { center, radius } = EMBLEM_ENCLOSING_CIRCLE;
  return {
    center: {
      x: left + (center.x - EMBLEM_BOUNDS.minX) * scale,
      y: top + (center.y - EMBLEM_BOUNDS.minY) * scale,
    },
    radius: radius * scale,
  };
}

/**
 * Places the emblem so the centre of its bounding box lands on `center`, sized
 * by the radius of its enclosing circle.
 */
export function placementCentered(center: Point, radius: number): EmblemPlacement {
  const scale = radius / EMBLEM_ENCLOSING_CIRCLE.radius;
  const boxCenter = {
    x: EMBLEM_BOUNDS.minX + EMBLEM_BOUNDS.width / 2,
    y: EMBLEM_BOUNDS.minY + EMBLEM_BOUNDS.height / 2,
  };
  return {
    center: {
      x: center.x + (EMBLEM_ENCLOSING_CIRCLE.center.x - boxCenter.x) * scale,
      y: center.y + (EMBLEM_ENCLOSING_CIRCLE.center.y - boxCenter.y) * scale,
    },
    radius,
  };
}

export function emblemScale(placement: EmblemPlacement): number {
  return placement.radius / EMBLEM_ENCLOSING_CIRCLE.radius;
}

function placementTransform(placement: EmblemPlacement): string {
  const scale = emblemScale(placement);
  const { center } = EMBLEM_ENCLOSING_CIRCLE;
  return translateScale(
    placement.center.x - center.x * scale,
    placement.center.y - center.y * scale,
    scale,
  );
}

function reliefLayers(id: string, relief: EmblemRelief, scale: number): Fragment {
  const shadowId = `${id}-shadow`;
  const shadows = relief.shadows.map((layer) => ({
    blur: layer.blur / scale,
    offsetX: layer.offsetX === undefined ? undefined : layer.offsetX / scale,
    offsetY: layer.offsetY / scale,
    opacity: layer.opacity,
  }));
  return fragment(
    [shadowFilter(shadowId, relief.shadowColor, shadows, SHADOW_MARGIN_RATIO)],
    [
      el('path', { d: EMBLEM_SILHOUETTE, fill: BRAND_COLORS.black, filter: url(shadowId) }),
      el('path', {
        d: EMBLEM_SILHOUETTE,
        fill: 'none',
        stroke: relief.contour.color,
        'stroke-opacity': relief.contour.opacity,
        'stroke-width': relief.contour.width / scale,
        'stroke-linejoin': 'round',
      }),
      ...(relief.rimLight
        ? [
            el('path', {
              d: EMBLEM_SILHOUETTE,
              fill: relief.rimLight.color,
              opacity: relief.rimLight.opacity,
              transform: translate(0, relief.rimLight.offsetY / scale),
            }),
          ]
        : []),
    ],
  );
}

/** The two-tone emblem, optionally placed and set into a surface. */
export function emblemArt(options: EmblemArtOptions): Fragment {
  const lightId = `${options.id}-light`;
  const shadeId = `${options.id}-shade`;
  const scale = options.placement ? emblemScale(options.placement) : 1;
  const relief = options.relief
    ? reliefLayers(options.id, options.relief, scale)
    : fragment([], []);
  const facets = [
    ...relief.body,
    el('path', { d: EMBLEM_RIDGE_UNDERLAY, fill: url(shadeId) }),
    ...EMBLEM_RIGHT_FACETS.map((d) => el('path', { d, fill: url(shadeId) })),
    ...EMBLEM_LEFT_FACETS.map((d) => el('path', { d, fill: url(lightId) })),
  ];
  const defs = [
    linearGradient(lightId, FACET_VECTOR, options.finish.light),
    linearGradient(shadeId, FACET_VECTOR, options.finish.shade),
    ...relief.defs,
  ];
  const body = options.placement
    ? [el('g', { transform: placementTransform(options.placement) }, ...facets)]
    : facets;
  return fragment(defs, body);
}

/** Chosen emblem paths in one flat colour (default `currentColor`), optionally placed. */
export function emblemFacets(
  paths: readonly string[],
  placement?: EmblemPlacement,
  fill = 'currentColor',
): Fragment {
  const shapes = paths.map((d) => el('path', { d, fill }));
  return fragment(
    [],
    placement ? [el('g', { transform: placementTransform(placement) }, ...shapes)] : shapes,
  );
}

/** Single-colour silhouette that inherits `currentColor`. */
export function emblemSilhouette(placement?: EmblemPlacement, fill = 'currentColor'): Fragment {
  return emblemFacets([EMBLEM_SILHOUETTE], placement, fill);
}
