/**
 * Measurements derived from the fixed emblem geometry in `emblem.ts`.
 * Nothing here changes the emblem; it only describes it so every rendering can
 * place it consistently (optical centre, circle-safe radius, facet seams).
 */
import { EMBLEM_FACETS, EMBLEM_SILHOUETTE } from './emblem';
import {
  boundsOf,
  minimalEnclosingCircle,
  parsePolygonPath,
  polygonsToPath,
  type Point,
  type Polygon,
} from './geometry';

/** Side of the emblem's square viewBox (`EMBLEM_VIEWBOX`). */
export const EMBLEM_UNITS = 100;
/** The emblem is mirror-symmetric about this vertical line. */
export const EMBLEM_AXIS_X = EMBLEM_UNITS / 2;

export const EMBLEM_POLYGONS: readonly Polygon[] = parsePolygonPath(EMBLEM_SILHOUETTE);
export const EMBLEM_BOUNDS = boundsOf(EMBLEM_POLYGONS);

/**
 * Smallest circle containing the emblem. Its centre sits almost exactly on the
 * emblem's area centroid, so it is both the optical centre and the point that
 * keeps the mark safe inside Discord's circular crops.
 */
export const EMBLEM_ENCLOSING_CIRCLE = minimalEnclosingCircle(EMBLEM_POLYGONS);

/** Width of the ridge underlay relative to the spear's full width. */
const RIDGE_UNDERLAY_WIDTH_RATIO = 0.12;

function spearOutline(): Polygon {
  const vertices = [
    ...parsePolygonPath(EMBLEM_FACETS.spearLeft).flat(),
    ...parsePolygonPath(EMBLEM_FACETS.spearRight).flat(),
  ];
  const onAxis = vertices.filter((p) => p.x === EMBLEM_AXIS_X);
  const top = onAxis.reduce((a, b) => (b.y < a.y ? b : a));
  const bottom = onAxis.reduce((a, b) => (b.y > a.y ? b : a));
  const left = vertices.reduce((a, b) => (b.x < a.x ? b : a));
  const right = vertices.reduce((a, b) => (b.x > a.x ? b : a));
  return [top, right, bottom, left];
}

function narrowAboutAxis(polygon: Polygon, ratio: number): Polygon {
  return polygon.map((p): Point => ({ x: EMBLEM_AXIS_X + (p.x - EMBLEM_AXIS_X) * ratio, y: p.y }));
}

/**
 * A hairline sliver along the spear ridge, strictly inside the spear. Painted
 * beneath the two spear facets so their shared edge never lets the background
 * bleed through anti-aliasing.
 */
export const EMBLEM_RIDGE_UNDERLAY = polygonsToPath([
  narrowAboutAxis(spearOutline(), RIDGE_UNDERLAY_WIDTH_RATIO),
]);
