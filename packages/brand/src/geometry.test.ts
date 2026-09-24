import { describe, expect, it } from 'vitest';
import {
  EMBLEM_FACETS,
  EMBLEM_LEFT_FACETS,
  EMBLEM_RIGHT_FACETS,
  EMBLEM_SILHOUETTE,
  EMBLEM_VIEWBOX,
} from './emblem';
import {
  EMBLEM_AXIS_X,
  EMBLEM_BOUNDS,
  EMBLEM_ENCLOSING_CIRCLE,
  EMBLEM_POLYGONS,
  EMBLEM_RIDGE_UNDERLAY,
  EMBLEM_UNITS,
} from './emblem-metrics';
import {
  areaOf,
  boundsOf,
  distance,
  minimalEnclosingCircle,
  mirrorX,
  parsePolygonPath,
  polygonsToPath,
  sameVertexSet,
  type Polygon,
} from './geometry';
import { ROLE_ICON_KEYS, ROLE_MARKS, ROLE_MARK_UNITS, roleMarkFacets } from './role-marks';

const EPSILON = 1e-9;

function only(d: string): Polygon {
  const [polygon, ...rest] = parsePolygonPath(d);
  if (!polygon || rest.length > 0) throw new Error(`Expected exactly one polygon in ${d}`);
  return polygon;
}

function pointInPolygon(point: { x: number; y: number }, polygon: Polygon): boolean {
  let inside = false;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length] ?? a;
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  });
  return inside;
}

describe('emblem geometry', () => {
  it('parses every exported path', () => {
    for (const d of [
      ...Object.values(EMBLEM_FACETS),
      EMBLEM_SILHOUETTE,
      ...EMBLEM_LEFT_FACETS,
      ...EMBLEM_RIGHT_FACETS,
    ]) {
      expect(parsePolygonPath(d).length).toBeGreaterThan(0);
    }
    expect(EMBLEM_POLYGONS).toHaveLength(3);
  });

  it('has a square viewBox matching the unit grid', () => {
    expect(EMBLEM_VIEWBOX).toBe(`0 0 ${EMBLEM_UNITS} ${EMBLEM_UNITS}`);
    expect(EMBLEM_BOUNDS.minX).toBeGreaterThanOrEqual(0);
    expect(EMBLEM_BOUNDS.minY).toBeGreaterThanOrEqual(0);
    expect(EMBLEM_BOUNDS.maxX).toBeLessThanOrEqual(EMBLEM_UNITS);
    expect(EMBLEM_BOUNDS.maxY).toBeLessThanOrEqual(EMBLEM_UNITS);
  });

  it('is mirror-symmetric about its axis', () => {
    const pairs = [
      [EMBLEM_FACETS.spearLeft, EMBLEM_FACETS.spearRight],
      [EMBLEM_FACETS.wingLeft, EMBLEM_FACETS.wingRight],
    ] as const;
    for (const [left, right] of pairs) {
      expect(sameVertexSet(mirrorX(only(left), EMBLEM_AXIS_X), only(right))).toBe(true);
    }
    expect(EMBLEM_BOUNDS.minX + EMBLEM_BOUNDS.maxX).toBeCloseTo(2 * EMBLEM_AXIS_X, 9);
  });

  it('builds the silhouette from exactly the facets', () => {
    const [spear, wingLeft, wingRight] = EMBLEM_POLYGONS;
    const spearFacets = [only(EMBLEM_FACETS.spearLeft), only(EMBLEM_FACETS.spearRight)];
    const facetArea = spearFacets.reduce((sum, p) => sum + areaOf(p), 0);
    expect(spear && areaOf(spear)).toBeCloseTo(facetArea, 9);
    expect(wingLeft && sameVertexSet(wingLeft, only(EMBLEM_FACETS.wingLeft))).toBe(true);
    expect(wingRight && sameVertexSet(wingRight, only(EMBLEM_FACETS.wingRight))).toBe(true);
  });

  it('finds the minimal enclosing circle', () => {
    const points = EMBLEM_POLYGONS.flat();
    const { center, radius } = EMBLEM_ENCLOSING_CIRCLE;
    expect(center.x).toBeCloseTo(EMBLEM_AXIS_X, 9);
    for (const p of points) expect(distance(p, center)).toBeLessThanOrEqual(radius + EPSILON);
    const onBoundary = points.filter((p) => Math.abs(distance(p, center) - radius) < 1e-6);
    expect(onBoundary.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the ridge underlay strictly inside the spear', () => {
    const [spear] = EMBLEM_POLYGONS;
    if (!spear) throw new Error('missing spear');
    const underlay = only(EMBLEM_RIDGE_UNDERLAY);
    const centroid = {
      x: underlay.reduce((sum, p) => sum + p.x, 0) / underlay.length,
      y: underlay.reduce((sum, p) => sum + p.y, 0) / underlay.length,
    };
    const inset = underlay.map((p) => ({
      x: centroid.x + (p.x - centroid.x) * 0.999,
      y: centroid.y + (p.y - centroid.y) * 0.999,
    }));
    for (const p of inset) expect(pointInPolygon(p, spear)).toBe(true);
  });

  it('round-trips through the serializer', () => {
    expect(parsePolygonPath(polygonsToPath(EMBLEM_POLYGONS))).toEqual(EMBLEM_POLYGONS);
  });
});

describe('role marks', () => {
  it.each(ROLE_ICON_KEYS)('%s parses and stays on the 64-unit grid', (key) => {
    const facets = roleMarkFacets(ROLE_MARKS[key]);
    expect(facets.length).toBeGreaterThan(0);
    const bounds = boundsOf(facets.flatMap((d) => parsePolygonPath(d)));
    expect(bounds.minX).toBeGreaterThanOrEqual(0);
    expect(bounds.minY).toBeGreaterThanOrEqual(0);
    expect(bounds.maxX).toBeLessThanOrEqual(ROLE_MARK_UNITS);
    expect(bounds.maxY).toBeLessThanOrEqual(ROLE_MARK_UNITS);
    // Big enough to read at 16px: at least half the grid in both directions.
    expect(bounds.width).toBeGreaterThanOrEqual(ROLE_MARK_UNITS / 2 - 8);
    expect(bounds.height).toBeGreaterThanOrEqual(ROLE_MARK_UNITS / 2);
  });

  it('gives every role a distinct silhouette', () => {
    const silhouettes = ROLE_ICON_KEYS.map((key) => roleMarkFacets(ROLE_MARKS[key]).join(' '));
    expect(new Set(silhouettes).size).toBe(ROLE_ICON_KEYS.length);
  });
});

describe('BREAK: path parser rejects anything but absolute M/L/Z polygons', () => {
  it.each([
    ['empty', ''],
    ['relative commands', 'm0 0 l10 0 l0 10 z'],
    ['curves', 'M0 0 C1 1 2 2 3 3 Z'],
    ['arcs', 'M0 0 A5 5 0 0 1 10 10 Z'],
    ['unclosed', 'M0 0 L10 0 L10 10'],
    ['too few vertices', 'M0 0 L10 0 Z'],
    ['attribute breakout', 'M0 0 L1 0 L1 1 Z" onload="alert(1)'],
    ['markup', 'M0 0 L1 0 L1 1 Z<script>'],
    ['non-numeric', 'M0 0 L1 x L1 1 Z'],
    ['nested M', 'M0 0 L1 0 M2 2 L3 3 L4 4 Z'],
  ])('%s', (_name, d) => {
    expect(() => parsePolygonPath(d)).toThrow();
  });

  it('refuses to serialize non-finite coordinates', () => {
    expect(() =>
      polygonsToPath([
        [
          { x: Number.NaN, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      ]),
    ).toThrow(RangeError);
  });

  it('needs two distinct points for an enclosing circle', () => {
    expect(() => minimalEnclosingCircle([[{ x: 1, y: 1 }]])).toThrow(RangeError);
  });
});
