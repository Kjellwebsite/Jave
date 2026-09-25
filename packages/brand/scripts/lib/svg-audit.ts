/**
 * Strict audit of the generated SVG sources: every element must be one the kit
 * uses, and every value that can put colour on screen must come from the
 * palette. The sources are machine-written (`src/svg/xml.ts`: double-quoted
 * attributes, no comments, no CDATA), so anything the tokenizer cannot account
 * for is itself reported as a problem instead of being skipped.
 */

/** Every element the kit writes. Anything else (style, script, animate, image…) is refused. */
const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  'svg',
  'title',
  'defs',
  'g',
  'path',
  'rect',
  'circle',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'filter',
  'feTurbulence',
  'feColorMatrix',
  'feMerge',
  'feMergeNode',
  'feComposite',
  'feGaussianBlur',
  'feOffset',
  'feFlood',
]);

/** Attributes whose value is a colour or a paint. */
const PAINT_ATTRIBUTES: ReadonlySet<string> = new Set([
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
  'lighting-color',
  'color',
]);

/** Shapes that paint with the default black fill unless given one. */
const SHAPE_ELEMENTS: ReadonlySet<string> = new Set(['path', 'rect', 'circle']);

const TAG = /<(\/?)([A-Za-z][\w.:-]*)((?:\s+[A-Za-z_:][\w.:-]*="[^"<>]*")*)\s*(\/?)>/g;
const ATTRIBUTE = /\s+([A-Za-z_:][\w.:-]*)="([^"<>]*)"/g;
const HEX_PAINT = /^#[0-9A-Fa-f]{6}$/;
const LOCAL_REFERENCE = /^url\(#([A-Za-z][\w.:-]*)\)$/;
const KEYWORD_PAINTS: ReadonlySet<string> = new Set(['none', 'currentColor']);
/** feColorMatrix `matrix` values: 4 rows × 5 columns. */
const COLOR_MATRIX_ROWS = 4;
const COLOR_MATRIX_COLUMNS = 5;
const RGB_ROWS = 3;

export interface SvgElement {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  /** The enclosing elements, outermost first. */
  readonly ancestors: readonly SvgElement[];
}

/** Tokenizes a generated SVG into its elements; throws on markup it cannot account for. */
export function parseSvgElements(svg: string): SvgElement[] {
  const elements: SvgElement[] = [];
  const open: SvgElement[] = [];
  let consumed = 0;
  for (const match of svg.matchAll(TAG)) {
    const between = svg.slice(consumed, match.index);
    if (/[<>]/.test(between)) throw new SyntaxError(`Unparseable markup near: ${between.trim()}`);
    consumed = match.index + match[0].length;
    const [, closing = '', name = '', rawAttributes = '', selfClosing = ''] = match;
    if (closing) {
      const top = open.pop();
      if (top?.name !== name) throw new SyntaxError(`Mismatched </${name}>`);
      continue;
    }
    const attributes = new Map<string, string>();
    for (const [, key = '', value = ''] of rawAttributes.matchAll(ATTRIBUTE)) {
      if (attributes.has(key)) throw new SyntaxError(`Duplicate attribute ${key} on <${name}>`);
      attributes.set(key, value);
    }
    const element: SvgElement = { name, attributes, ancestors: [...open] };
    elements.push(element);
    if (!selfClosing) open.push(element);
  }
  if (/[<>]/.test(svg.slice(consumed))) throw new SyntaxError('Unparseable trailing markup');
  if (open.length > 0) throw new SyntaxError(`Unclosed <${open.map((e) => e.name).join('>, <')}>`);
  return elements;
}

function referenceProblem(value: string, ids: ReadonlySet<string>): string | null {
  const reference = LOCAL_REFERENCE.exec(value);
  if (!reference) return 'is not a local url(#id) reference';
  return ids.has(reference[1] ?? '') ? null : 'references an undefined id';
}

function paintProblem(
  value: string,
  palette: ReadonlySet<string>,
  ids: ReadonlySet<string>,
): string | null {
  if (KEYWORD_PAINTS.has(value)) return null;
  if (value.startsWith('url(')) return referenceProblem(value, ids);
  if (!HEX_PAINT.test(value)) return 'is not a #RRGGBB colour, none, currentColor or url(#id)';
  return palette.has(value.toUpperCase()) ? null : 'is not in the palette';
}

/** An feColorMatrix that gives R, G and B the same row can only output greys. */
function colorMatrixProblem(element: SvgElement): string | null {
  if (element.attributes.get('type') !== 'matrix') return 'must use type="matrix"';
  const values = (element.attributes.get('values') ?? '').trim().split(/\s+/).map(Number);
  if (values.length !== COLOR_MATRIX_ROWS * COLOR_MATRIX_COLUMNS || values.some(Number.isNaN)) {
    return 'has malformed values';
  }
  const row = (index: number): string =>
    values.slice(index * COLOR_MATRIX_COLUMNS, (index + 1) * COLOR_MATRIX_COLUMNS).join(' ');
  const rgbRows = Array.from({ length: RGB_ROWS }, (_, index) => row(index));
  return rgbRows.every((r) => r === rgbRows[0]) ? null : 'can tint (R, G and B rows differ)';
}

function isChildOf(element: SvgElement, parent: SvgElement): boolean {
  return element.ancestors[element.ancestors.length - 1] === parent;
}

/** Primitives that generate an image instead of reading one. */
const GENERATOR_PRIMITIVES: ReadonlySet<string> = new Set(['feTurbulence', 'feFlood']);

/** The results a primitive reads; `undefined` stands for the implicit previous result. */
function primitiveInputs(
  primitive: SvgElement,
  elements: readonly SvgElement[],
): (string | undefined)[] {
  if (GENERATOR_PRIMITIVES.has(primitive.name)) return [];
  if (primitive.name === 'feMerge') {
    return elements
      .filter((node) => isChildOf(node, primitive))
      .map((node) => node.attributes.get('in'));
  }
  const second = primitive.attributes.get('in2');
  const first = primitive.attributes.get('in');
  return second === undefined ? [first] : [first, second];
}

/**
 * feTurbulence makes independent noise in R, G and B — coloured static. It may
 * only feed an feColorMatrix (audited above to output greys), never another
 * primitive or the filter's output. An omitted `in` reads the previous
 * primitive's result.
 */
function turbulenceProblems(elements: readonly SvgElement[]): string[] {
  const problems: string[] = [];
  for (const filter of elements.filter((element) => element.name === 'filter')) {
    const primitives = elements.filter((element) => isChildOf(element, filter));
    const noise = new Set<string>();
    primitives.forEach((primitive, index) => {
      const previousIsNoise = primitives[index - 1]?.name === 'feTurbulence';
      const readsNoise = (input: string | undefined): boolean =>
        input === undefined ? previousIsNoise : noise.has(input);
      if (
        primitive.name !== 'feColorMatrix' &&
        primitiveInputs(primitive, elements).some(readsNoise)
      ) {
        problems.push(`<${primitive.name}> reads raw feTurbulence noise (coloured)`);
      }
      const result = primitive.attributes.get('result');
      if (result !== undefined) {
        if (primitive.name === 'feTurbulence') noise.add(result);
        else noise.delete(result);
      }
    });
    if (primitives[primitives.length - 1]?.name === 'feTurbulence') {
      problems.push('<feTurbulence> is the filter output (coloured noise)');
    }
  }
  return problems;
}

function hasInheritedFill(element: SvgElement): boolean {
  return [element, ...element.ancestors].some((e) => e.attributes.has('fill'));
}

/**
 * Lists every way `svg` could show a colour outside `palette` (uppercase
 * `#RRGGBB` values): unknown elements, inline CSS, non-palette or
 * non-hex paints, dangling or external references, tinting colour matrices,
 * raw (coloured) turbulence noise and shapes left on the default black fill.
 * Empty means clean.
 */
export function auditSvgPaint(svg: string, palette: ReadonlySet<string>): string[] {
  const elements = parseSvgElements(svg);
  const ids = new Set(
    elements.flatMap((element) => {
      const id = element.attributes.get('id');
      return id === undefined ? [] : [id];
    }),
  );
  const problems: string[] = [];
  for (const element of elements) {
    const where = `<${element.name}>`;
    if (!ALLOWED_ELEMENTS.has(element.name)) problems.push(`${where} is not an allowed element`);
    for (const [name, value] of element.attributes) {
      if (name === 'style') problems.push(`${where} has inline CSS (style="${value}")`);
      const problem = PAINT_ATTRIBUTES.has(name)
        ? paintProblem(value, palette, ids)
        : value.includes('url(')
          ? referenceProblem(value, ids)
          : null;
      if (problem) problems.push(`${where} ${name}="${value}" ${problem}`);
    }
    if (element.name === 'feColorMatrix') {
      const problem = colorMatrixProblem(element);
      if (problem) problems.push(`${where} ${problem}`);
    }
    const inClip = element.ancestors.some((ancestor) => ancestor.name === 'clipPath');
    if (SHAPE_ELEMENTS.has(element.name) && !inClip && !hasInheritedFill(element)) {
      problems.push(`${where} has no fill (would paint default black)`);
    }
  }
  return [...problems, ...turbulenceProblems(elements)];
}
