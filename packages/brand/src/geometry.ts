/**
 * Minimal, strict geometry helpers for the brand's polygonal marks.
 *
 * Every JAVELIN mark is built from straight-edged facets, so the only path
 * syntax we accept is absolute `M`, `L` and `Z`. Anything else is rejected so a
 * malformed or smuggled path can never slip into a rendered asset.
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Polygon = readonly Point[];

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

export interface Circle {
  readonly center: Point;
  readonly radius: number;
}

const MIN_POLYGON_VERTICES = 3;
/** Tolerance for floating-point containment checks, in path units. */
const GEOMETRY_EPSILON = 1e-9;
const PATH_TOKEN = /\s*(?:([MLZ])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?))\s*,?/y;

type PathToken = { kind: 'command'; value: 'M' | 'L' | 'Z' } | { kind: 'number'; value: number };

function tokenize(path: string): PathToken[] {
  const d = path.trim();
  const tokens: PathToken[] = [];
  const pattern = new RegExp(PATH_TOKEN.source, 'y');
  while (pattern.lastIndex < d.length) {
    const start = pattern.lastIndex;
    const match = pattern.exec(d);
    if (!match || pattern.lastIndex === start) {
      throw new SyntaxError(`Unsupported path syntax at offset ${start}: only absolute M, L, Z.`);
    }
    const [, command, numeric] = match;
    if (command === 'M' || command === 'L' || command === 'Z') {
      tokens.push({ kind: 'command', value: command });
    } else if (numeric !== undefined) {
      tokens.push({ kind: 'number', value: Number(numeric) });
    }
  }
  return tokens;
}

/** Parses an absolute M/L/Z path into closed polygons (one per subpath). */
export function parsePolygonPath(d: string): Polygon[] {
  const tokens = tokenize(d);
  const polygons: Polygon[] = [];
  let current: Point[] | null = null;
  let index = 0;

  const readPoint = (): Point => {
    const x = tokens[index];
    const y = tokens[index + 1];
    if (x?.kind !== 'number' || y?.kind !== 'number') {
      throw new SyntaxError('Path command expects an x y coordinate pair.');
    }
    index += 2;
    return { x: x.value, y: y.value };
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (token?.kind !== 'command')
      throw new SyntaxError('Path must start each segment with M, L or Z.');
    index += 1;
    if (token.value === 'M') {
      if (current) throw new SyntaxError('Every subpath must be closed with Z before the next M.');
      current = [readPoint()];
    } else if (token.value === 'L') {
      if (!current) throw new SyntaxError('L must follow M.');
      current.push(readPoint());
      while (tokens[index]?.kind === 'number') current.push(readPoint());
    } else {
      if (!current || current.length < MIN_POLYGON_VERTICES) {
        throw new SyntaxError(`A closed subpath needs at least ${MIN_POLYGON_VERTICES} vertices.`);
      }
      polygons.push(current);
      current = null;
    }
  }
  if (current) throw new SyntaxError('Path ends with an unclosed subpath.');
  if (polygons.length === 0) throw new SyntaxError('Path is empty.');
  return polygons;
}

const SERIALIZED_DECIMALS = 4;

function coordinate(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Non-finite coordinate: ${value}`);
  const rounded = Number(value.toFixed(SERIALIZED_DECIMALS));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** Serializes polygons back into an absolute M/L/Z path. */
export function polygonsToPath(polygons: readonly Polygon[]): string {
  return polygons
    .map((polygon) => {
      const [first, ...rest] = polygon;
      if (!first) throw new RangeError('Cannot serialize an empty polygon.');
      const lines = rest.map((p) => `L${coordinate(p.x)} ${coordinate(p.y)}`).join(' ');
      return `M${coordinate(first.x)} ${coordinate(first.y)} ${lines} Z`;
    })
    .join(' ');
}

export function boundsOf(polygons: readonly Polygon[]): Bounds {
  const points = polygons.flat();
  if (points.length === 0) throw new RangeError('Cannot measure an empty shape.');
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Shoelace area (positive regardless of winding). */
export function areaOf(polygon: Polygon): number {
  let twice = 0;
  polygon.forEach((p, i) => {
    const next = polygon[(i + 1) % polygon.length] ?? p;
    twice += p.x * next.y - next.x * p.y;
  });
  return Math.abs(twice) / 2;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function circleFromDiameter(a: Point, b: Point): Circle {
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return { center, radius: distance(a, center) };
}

function circumcircle(a: Point, b: Point, c: Point): Circle | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < GEOMETRY_EPSILON) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const center = {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
  return { center, radius: distance(a, center) };
}

function encloses(circle: Circle, points: readonly Point[]): boolean {
  return points.every((p) => distance(p, circle.center) <= circle.radius + GEOMETRY_EPSILON);
}

/**
 * Smallest circle enclosing every vertex. Exhaustive over pairs and triples —
 * exact and deterministic, and our marks have only a handful of vertices.
 */
export function minimalEnclosingCircle(polygons: readonly Polygon[]): Circle {
  const points = polygons.flat();
  const candidates: Circle[] = [];
  points.forEach((a, i) => {
    points.slice(i + 1).forEach((b, offset) => {
      candidates.push(circleFromDiameter(a, b));
      for (const c of points.slice(i + offset + 2)) {
        const circle = circumcircle(a, b, c);
        if (circle) candidates.push(circle);
      }
    });
  });
  const enclosing = candidates.filter((circle) => encloses(circle, points));
  const smallest = enclosing.reduce<Circle | null>(
    (best, circle) => (!best || circle.radius < best.radius ? circle : best),
    null,
  );
  if (!smallest) throw new RangeError('A shape needs at least two distinct vertices.');
  return smallest;
}

/** Mirrors a polygon across the vertical line x = axisX. */
export function mirrorX(polygon: Polygon, axisX: number): Polygon {
  return polygon.map((p) => ({ x: 2 * axisX - p.x, y: p.y }));
}

/** True when both polygons have the same vertex set (order and winding ignored). */
export function sameVertexSet(a: Polygon, b: Polygon): boolean {
  const key = (p: Point): string => `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  return left.length === right.length && left.every((value, i) => value === right[i]);
}
