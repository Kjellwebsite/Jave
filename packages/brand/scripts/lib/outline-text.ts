/**
 * Converts text to outline paths with opentype.js, so no brand asset depends
 * on an installed font. Layout is deliberately simple and fully deterministic:
 * glyph advances, the font's own kerning, and uniform tracking.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { OutlinedText } from '../../src/svg/typography';

/** The subset of the opentype.js API this module relies on. */
interface OpenTypePathCommandMove {
  readonly type: 'M' | 'L';
  readonly x: number;
  readonly y: number;
}
interface OpenTypePathCommandQuad {
  readonly type: 'Q';
  readonly x1: number;
  readonly y1: number;
  readonly x: number;
  readonly y: number;
}
interface OpenTypePathCommandCubic {
  readonly type: 'C';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly x: number;
  readonly y: number;
}
interface OpenTypePathCommandClose {
  readonly type: 'Z';
}
type OpenTypePathCommand =
  | OpenTypePathCommandMove
  | OpenTypePathCommandQuad
  | OpenTypePathCommandCubic
  | OpenTypePathCommandClose;

interface OpenTypeGlyph {
  readonly index: number;
  readonly advanceWidth?: number;
  getPath(
    x: number,
    y: number,
    fontSize: number,
  ): { readonly commands: readonly OpenTypePathCommand[] };
}

export interface OpenTypeFont {
  readonly unitsPerEm: number;
  readonly tables: { readonly os2?: { readonly sCapHeight?: number } };
  charToGlyph(char: string): OpenTypeGlyph;
  getKerningValue(left: OpenTypeGlyph, right: OpenTypeGlyph): number;
}

interface OpenTypeModule {
  parse(buffer: ArrayBuffer): OpenTypeFont;
}

/** opentype.js ships a UMD bundle; `require` is its most reliable entry point. */
function loadOpenType(): OpenTypeModule {
  const loaded: unknown = createRequire(import.meta.url)('opentype.js');
  if (
    typeof loaded !== 'object' ||
    loaded === null ||
    !('parse' in loaded) ||
    typeof loaded.parse !== 'function'
  ) {
    throw new TypeError('opentype.js did not load: missing parse().');
  }
  return loaded as OpenTypeModule;
}

/** Glyph index 0 is `.notdef` — the "tofu" box a font draws for missing characters. */
const NOTDEF_GLYPH_INDEX = 0;
/** Decimal places kept in outlined path data (font units; 1000 per em for Orbitron). */
const PATH_DECIMALS = 1;

export function loadFont(path: string): OpenTypeFont {
  const bytes = readFileSync(path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const font = loadOpenType().parse(buffer);
  if (!Number.isFinite(font.unitsPerEm) || font.unitsPerEm <= 0) {
    throw new RangeError(`Font ${path} has no valid unitsPerEm.`);
  }
  return font;
}

export interface OutlineOptions {
  /** Extra space between glyphs, in em. Orbitron wordmarks use wide tracking. */
  readonly trackingEm: number;
}

function capHeightOf(font: OpenTypeFont): number {
  const fromTable = font.tables.os2?.sCapHeight;
  if (fromTable !== undefined && fromTable > 0) return fromTable;
  throw new RangeError('Font has no OS/2 cap height; cannot size outlined type.');
}

function round(value: number): string {
  const rounded = Number(value.toFixed(PATH_DECIMALS));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

interface InkBounds {
  minX: number;
  maxX: number;
}

function commandPoints(command: OpenTypePathCommand): readonly number[] {
  switch (command.type) {
    case 'M':
    case 'L':
      return [command.x];
    case 'Q':
      return [command.x1, command.x];
    case 'C':
      return [command.x1, command.x2, command.x];
    case 'Z':
      return [];
  }
}

function serialize(command: OpenTypePathCommand, shiftX: number): string {
  const x = (value: number): string => round(value - shiftX);
  switch (command.type) {
    case 'M':
    case 'L':
      return `${command.type}${x(command.x)} ${round(command.y)}`;
    case 'Q':
      return `Q${x(command.x1)} ${round(command.y1)} ${x(command.x)} ${round(command.y)}`;
    case 'C':
      return `C${x(command.x1)} ${round(command.y1)} ${x(command.x2)} ${round(command.y2)} ${x(command.x)} ${round(command.y)}`;
    case 'Z':
      return 'Z';
  }
}

/**
 * Lays out `text` on a baseline at y = 0 (y pointing down, as in SVG) in font
 * units, and returns it as one path whose ink starts at x = 0.
 *
 * Ink bounds come from the outline's points, control points included. Fonts
 * place on-curve points at extremes (Orbitron does), so this is exact for
 * them and conservative otherwise; the tests check it against resvg.
 *
 * Throws when a character is missing from the font rather than drawing tofu.
 */
export function outlineText(
  font: OpenTypeFont,
  text: string,
  options: OutlineOptions,
): OutlinedText {
  const characters = Array.from(text);
  if (characters.length === 0) throw new RangeError('Cannot outline empty text.');
  const glyphs = characters.map((char) => {
    const glyph = font.charToGlyph(char);
    if (glyph.index === NOTDEF_GLYPH_INDEX) {
      throw new RangeError(
        `Font has no glyph for U+${char.codePointAt(0)?.toString(16).toUpperCase()}.`,
      );
    }
    return glyph;
  });

  const tracking = options.trackingEm * font.unitsPerEm;
  const commands: OpenTypePathCommand[] = [];
  let penX = 0;
  glyphs.forEach((glyph, i) => {
    commands.push(...glyph.getPath(penX, 0, font.unitsPerEm).commands);
    const next = glyphs[i + 1];
    if (next) penX += (glyph.advanceWidth ?? 0) + font.getKerningValue(glyph, next) + tracking;
  });

  const ink = commands
    .flatMap(commandPoints)
    .reduce<InkBounds>(
      (bounds, x) => ({ minX: Math.min(bounds.minX, x), maxX: Math.max(bounds.maxX, x) }),
      { minX: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY },
    );
  if (!Number.isFinite(ink.minX)) throw new RangeError(`Text "${text}" has no ink.`);

  return {
    text,
    d: commands.map((command) => serialize(command, ink.minX)).join(''),
    width: ink.maxX - ink.minX,
    capHeight: capHeightOf(font),
  };
}
