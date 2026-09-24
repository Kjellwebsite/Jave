/**
 * A tiny, escaping SVG writer. Every attribute value and text node passes
 * through `escapeXml`, element and attribute names are validated, and numbers
 * are written with fixed precision so output is byte-for-byte reproducible.
 */
const XML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Decimal places kept for coordinates and lengths written into SVG. */
const NUMBER_PRECISION = 3;
/**
 * Decimal places kept for scale factors. Scales multiply every coordinate
 * after them, so they need more precision: 12/720 written as 0.017 would
 * render outlined type 2% too wide.
 */
const SCALE_PRECISION = 6;
const XML_NAME = /^[A-Za-z][\w.:-]*$/;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

function round(value: number, decimals: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Non-finite number in SVG output: ${value}`);
  const rounded = Number(value.toFixed(decimals));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export function fmt(value: number): string {
  return round(value, NUMBER_PRECISION);
}

export function fmtScale(value: number): string {
  return round(value, SCALE_PRECISION);
}

export type AttributeValue = string | number | null | undefined;
export type Attributes = Readonly<Record<string, AttributeValue>>;

function assertName(name: string): void {
  if (!XML_NAME.test(name)) throw new RangeError(`Invalid XML name: ${name}`);
}

function renderAttributes(attributes: Attributes): string {
  return Object.entries(attributes)
    .filter(
      (entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined,
    )
    .map(([name, value]) => {
      assertName(name);
      const text = typeof value === 'number' ? fmt(value) : escapeXml(value);
      return ` ${name}="${text}"`;
    })
    .join('');
}

/** Builds one element. Children are already-rendered markup. */
export function el(
  name: string,
  attributes: Attributes = {},
  ...children: readonly string[]
): string {
  assertName(name);
  const open = `<${name}${renderAttributes(attributes)}`;
  return children.length === 0 ? `${open}/>` : `${open}>${children.join('')}</${name}>`;
}

/** An escaped text node. */
export function textNode(value: string): string {
  return escapeXml(value);
}

export function url(id: string): string {
  assertName(id);
  return `url(#${id})`;
}

export function translate(x: number, y: number): string {
  return `translate(${fmt(x)} ${fmt(y)})`;
}

export function translateScale(x: number, y: number, scale: number): string {
  return `translate(${fmt(x)} ${fmt(y)}) scale(${fmtScale(scale)})`;
}

/** A rendered piece of artwork: shared definitions plus the drawing itself. */
export interface Fragment {
  readonly defs: readonly string[];
  readonly body: readonly string[];
}

export function fragment(defs: readonly string[], body: readonly string[]): Fragment {
  return { defs, body };
}

export function combine(...fragments: readonly Fragment[]): Fragment {
  return {
    defs: fragments.flatMap((f) => f.defs),
    body: fragments.flatMap((f) => f.body),
  };
}

export interface SvgDocument {
  readonly width: number;
  readonly height: number;
  /** Defaults to `0 0 width height`. */
  readonly viewBox?: string;
  /** Accessible name; also written as `<title>`. */
  readonly title: string;
  readonly content: Fragment;
}

/** Serializes a standalone SVG file (one element per line for readable diffs). */
export function svgDocument(doc: SvgDocument): string {
  const viewBox = doc.viewBox ?? `0 0 ${fmt(doc.width)} ${fmt(doc.height)}`;
  const lines = [
    `<svg xmlns="${SVG_NAMESPACE}" width="${fmt(doc.width)}" height="${fmt(doc.height)}" viewBox="${escapeXml(viewBox)}" role="img" aria-label="${escapeXml(doc.title)}">`,
    el('title', {}, textNode(doc.title)),
    ...(doc.content.defs.length > 0 ? ['<defs>', ...doc.content.defs, '</defs>'] : []),
    ...doc.content.body,
    '</svg>',
  ];
  return `${lines.join('\n')}\n`;
}
