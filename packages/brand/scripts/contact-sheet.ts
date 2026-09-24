/**
 * Visual review: renders every brand asset into contact sheets under
 * `preview/` (git-ignored). Icons appear at their real Discord sizes, circle
 * cropped the way Discord crops them, on dark and light client surfaces, with
 * magnified pixel views of the 32px and 16px reductions.
 *
 *   pnpm --filter @jave/brand preview
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { METAL_TONES } from '../src/colors';
import { BRAND_ASSETS, type BrandAssetId } from '../src/manifest';
import { ROLE_ICON_KEYS } from '../src/role-marks';
import { buildBrandSvgs } from '../src/svg/catalog';
import { el, fragment, svgDocument, url } from '../src/svg/xml';
import { placeText, type OutlinedText } from '../src/svg/typography';
import { MOTTO_FONT_FILE, fontPath, loadBrandTypography } from './lib/brand-typography';
import { loadFont, outlineText } from './lib/outline-text';
import { PREVIEW_DIR, packagePath } from './lib/paths';
import { encodePng, type RgbaImage } from './lib/png';
import { rasterize, rasterizeSizes, renderSvg, toStraightAlpha } from './lib/raster';

const SHEET_WIDTH = 1560;
const PADDING = 28;
const GAP = 24;
const LABEL_CAP_HEIGHT = 9;
const LABEL_SPACE = 30;
const CAPTION_CAP_HEIGHT = 6;
const CAPTION_SPACE = 18;
const LABEL_TRACKING_EM = 0.2;
/** Magnification for pixel-level views of tiny renders. */
const MAGNIFY_32 = 6;
const MAGNIFY_16 = 8;

type Surface = 'dark' | 'light';

/** Discord client surfaces (server list, light sidebar), to judge assets in context. */
const DISCORD_DARK_SURFACE = '#1E1F22';
const DISCORD_LIGHT_SURFACE = '#F2F3F5';

const SURFACES: Readonly<Record<Surface, { readonly fill: string; readonly ink: string }>> = {
  dark: { fill: DISCORD_DARK_SURFACE, ink: METAL_TONES.aluminiumLow },
  light: { fill: DISCORD_LIGHT_SURFACE, ink: METAL_TONES.steelDeep },
};

interface Tile {
  readonly image: RgbaImage;
  readonly scale?: number;
  readonly circle?: boolean;
  readonly caption: string;
}

interface Row {
  readonly title: string;
  readonly surface: Surface;
  readonly tiles: readonly Tile[];
}

interface Sheet {
  readonly file: string;
  readonly rows: readonly Row[];
}

/** Sheet labels use the motto's face: small, tracked Orbitron. */
const labelFont = loadFont(fontPath(MOTTO_FONT_FILE));
const labelCache = new Map<string, OutlinedText>();

function label(text: string): OutlinedText {
  const cached = labelCache.get(text);
  if (cached) return cached;
  const outlined = outlineText(labelFont, text.toUpperCase(), { trackingEm: LABEL_TRACKING_EM });
  labelCache.set(text, outlined);
  return outlined;
}

function dataUri(image: RgbaImage): string {
  return `data:image/png;base64,${encodePng(image).toString('base64')}`;
}

function tileSize(tile: Tile): { width: number; height: number } {
  const scale = tile.scale ?? 1;
  return { width: tile.image.width * scale, height: tile.image.height * scale };
}

/** Horizontal room a tile needs: its image or its caption, whichever is wider. */
function slotWidth(tile: Tile): number {
  if (tile.caption === '') return tileSize(tile).width;
  const caption = label(tile.caption);
  return Math.max(tileSize(tile).width, (caption.width * CAPTION_CAP_HEIGHT) / caption.capHeight);
}

interface Placed {
  readonly tile: Tile;
  readonly x: number;
  readonly y: number;
}

/** Flows tiles left to right, wrapping at the sheet edge; returns positions and height. */
function flow(tiles: readonly Tile[], top: number): { placed: Placed[]; bottom: number } {
  const placed: Placed[] = [];
  let x = PADDING;
  let lineTop = top;
  let lineHeight = 0;
  for (const tile of tiles) {
    const size = tileSize(tile);
    const slot = slotWidth(tile);
    if (x > PADDING && x + slot > SHEET_WIDTH - PADDING) {
      x = PADDING;
      lineTop += lineHeight + CAPTION_SPACE + GAP;
      lineHeight = 0;
    }
    placed.push({ tile, x, y: lineTop });
    x += slot + GAP;
    lineHeight = Math.max(lineHeight, size.height);
  }
  return { placed, bottom: lineTop + lineHeight + CAPTION_SPACE };
}

function tileMarkup(item: Placed, index: string, ink: string): { defs: string[]; body: string[] } {
  const { width, height } = tileSize(item.tile);
  const clipId = `clip-${index}`;
  const pixelated = (item.tile.scale ?? 1) > 1;
  const image = el('image', {
    x: item.x,
    y: item.y,
    width,
    height,
    href: dataUri(item.tile.image),
    'image-rendering': pixelated ? 'optimizeSpeed' : 'optimizeQuality',
    'clip-path': item.tile.circle ? url(clipId) : undefined,
  });
  const defs = item.tile.circle
    ? [
        el(
          'clipPath',
          { id: clipId },
          el('circle', { cx: item.x + width / 2, cy: item.y + height / 2, r: width / 2 }),
        ),
      ]
    : [];
  const captions =
    item.tile.caption === ''
      ? []
      : [
          placeText(label(item.tile.caption), {
            x: item.x,
            baselineY: item.y + height + CAPTION_SPACE - CAPTION_CAP_HEIGHT / 2,
            capHeight: CAPTION_CAP_HEIGHT,
            align: 'start',
            fill: ink,
          }),
        ];
  return { defs, body: [image, ...captions] };
}

function renderSheet(sheet: Sheet): Buffer {
  const defs: string[] = [];
  const body: string[] = [];
  let top = 0;
  sheet.rows.forEach((row, rowIndex) => {
    const surface = SURFACES[row.surface];
    const { placed, bottom } = flow(row.tiles, top + PADDING + LABEL_SPACE);
    const rowHeight = bottom + PADDING - top;
    body.push(
      el('rect', { x: 0, y: top, width: SHEET_WIDTH, height: rowHeight, fill: surface.fill }),
    );
    body.push(
      placeText(label(row.title), {
        x: PADDING,
        baselineY: top + PADDING + LABEL_CAP_HEIGHT,
        capHeight: LABEL_CAP_HEIGHT,
        align: 'start',
        fill: surface.ink,
      }),
    );
    placed.forEach((item, tileIndex) => {
      const markup = tileMarkup(item, `${rowIndex}-${tileIndex}`, surface.ink);
      defs.push(...markup.defs);
      body.push(...markup.body);
    });
    top += rowHeight;
  });
  const svg = svgDocument({
    width: SHEET_WIDTH,
    height: top,
    title: `JAVELIN brand review — ${sheet.file}`,
    content: fragment(defs, body),
  });
  return encodePng(toStraightAlpha(renderSvg(svg, SHEET_WIDTH)));
}

const svgs = buildBrandSvgs(loadBrandTypography());

function sizes(id: BrandAssetId, list: readonly number[]): RgbaImage[] {
  return rasterizeSizes(
    svgs[id],
    list.map((size) => ({ width: size, height: size })),
  );
}

function iconRows(id: BrandAssetId, title: string): Row[] {
  const [s512, s128, s64, s48, s32, s16] = sizes(id, [512, 128, 64, 48, 32, 16]);
  if (!s512 || !s128 || !s64 || !s48 || !s32 || !s16)
    throw new Error(`Missing reductions for ${id}.`);
  const tiles: Tile[] = [
    { image: s512, circle: true, caption: '512 circle crop' },
    { image: s128, caption: '128 square' },
    { image: s128, circle: true, caption: '128' },
    { image: s64, circle: true, caption: '64' },
    { image: s48, circle: true, caption: '48 guild list' },
    { image: s32, circle: true, caption: '32' },
    { image: s16, circle: true, caption: '16' },
    { image: s32, scale: MAGNIFY_32, circle: true, caption: `32 at ${MAGNIFY_32}x` },
    { image: s16, scale: MAGNIFY_16, circle: true, caption: `16 at ${MAGNIFY_16}x` },
  ];
  return (['dark', 'light'] as const).map((surface) => ({
    title: `${title} / ${surface}`,
    surface,
    tiles,
  }));
}

function webIconRows(): Row[] {
  const [f32, f16] = rasterizeSizes(svgs.favicon, [
    { width: 32, height: 32 },
    { width: 16, height: 16 },
  ]);
  if (!f32 || !f16) throw new Error('Missing favicon renders.');
  const touch = rasterize(svgs['apple-touch-icon'], 180, 180);
  const tiles: Tile[] = [
    { image: touch, caption: 'apple touch 180' },
    { image: f32, caption: 'favicon 32' },
    { image: f16, caption: 'favicon 16' },
    { image: f32, scale: MAGNIFY_32, caption: `favicon 32 at ${MAGNIFY_32}x` },
    { image: f16, scale: MAGNIFY_16, caption: `favicon 16 at ${MAGNIFY_16}x` },
  ];
  return (['dark', 'light'] as const).map((surface) => ({
    title: `web icons / ${surface}`,
    surface,
    tiles,
  }));
}

/** Discord draws role icons at about this size next to a member's name. */
const ROLE_CHAT_SIZE = 20;
const ROLE_MAGNIFY = 4;

function roleRows(): Row[] {
  const renders = ROLE_ICON_KEYS.map((key) => {
    const [s64, chat, s16] = sizes(`role-${key}`, [64, ROLE_CHAT_SIZE, 16]);
    if (!s64 || !chat || !s16) throw new Error(`Missing role renders for ${key}.`);
    return { key, s64, chat, s16 };
  });
  const tiles: Tile[] = [
    ...renders.map((r) => ({ image: r.s64, caption: r.key })),
    ...renders.map((r, i) => ({ image: r.chat, caption: i === 0 ? `${ROLE_CHAT_SIZE}px` : '' })),
    ...renders.map((r, i) => ({ image: r.s16, caption: i === 0 ? '16px' : '' })),
    ...renders.map((r, i) => ({
      image: r.s16,
      scale: ROLE_MAGNIFY,
      caption: i === 0 ? `16 at ${ROLE_MAGNIFY}x` : '',
    })),
  ];
  return (['dark', 'light'] as const).map((surface) => ({
    title: `role icons / ${surface}`,
    surface,
    tiles,
  }));
}

/** Largest width a wide asset is shown at on a sheet. */
const WIDE_PREVIEW_WIDTH = SHEET_WIDTH - 2 * PADDING;
const HALF_PREVIEW_WIDTH = (WIDE_PREVIEW_WIDTH - GAP) / 2;

function fitWidth(id: BrandAssetId, width: number): RgbaImage {
  return toStraightAlpha(renderSvg(svgs[id], width));
}

function markRows(): Row[] {
  const dark: Tile[] = [
    { image: fitWidth('emblem', 200), caption: 'emblem' },
    { image: fitWidth('lockup', 560), caption: 'lockup' },
    { image: fitWidth('lockup-stacked', 300), caption: 'lockup stacked' },
    { image: fitWidth('wordmark', 400), caption: 'wordmark' },
    { image: fitWidth('wordmark', 120), caption: 'wordmark 120px' },
  ];
  const light: Tile[] = [
    { image: fitWidth('emblem-on-light', 200), caption: 'emblem on light' },
    { image: fitWidth('lockup-on-light', 560), caption: 'lockup on light' },
    { image: fitWidth('lockup-stacked-on-light', 300), caption: 'lockup stacked on light' },
    { image: fitWidth('wordmark-on-light', 400), caption: 'wordmark on light' },
    { image: fitWidth('wordmark-on-light', 120), caption: 'wordmark 120px' },
  ];
  return [
    { title: 'marks / dark', surface: 'dark', tiles: dark },
    { title: 'marks / light', surface: 'light', tiles: light },
  ];
}

function sceneRows(): Row[] {
  return [
    {
      title: 'discord server banner 960x540 / og image 1200x630',
      surface: 'dark',
      tiles: [
        { image: fitWidth('server-banner', HALF_PREVIEW_WIDTH), caption: 'server banner' },
        { image: fitWidth('og-image', HALF_PREVIEW_WIDTH), caption: 'og image' },
      ],
    },
    {
      title: 'discord invite splash 1920x1080',
      surface: 'dark',
      tiles: [{ image: fitWidth('invite-splash', WIDE_PREVIEW_WIDTH), caption: 'invite splash' }],
    },
  ];
}

interface SheetSpec {
  readonly file: string;
  readonly rows: () => Row[];
}

const SHEETS: readonly SheetSpec[] = [
  { file: 'sheet-server-icon.png', rows: () => iconRows('server-icon', 'server icon') },
  {
    file: 'sheet-avatar-web.png',
    rows: () => [...iconRows('bot-avatar', 'bot avatar'), ...webIconRows()],
  },
  { file: 'sheet-roles-marks.png', rows: () => [...roleRows(), ...markRows()] },
  { file: 'sheet-scenes.png', rows: sceneRows },
];

/** With no arguments, renders every sheet plus the combined contact sheet. */
function main(args: readonly string[]): void {
  const directory = packagePath(PREVIEW_DIR);
  mkdirSync(directory, { recursive: true });
  const selected =
    args.length === 0
      ? SHEETS
      : SHEETS.filter((spec) => args.some((arg) => spec.file.includes(arg)));
  if (selected.length === 0) throw new RangeError(`No sheet matches ${args.join(', ')}.`);
  const allRows: Row[] = [];
  const emit = (sheet: Sheet): void => {
    writeFileSync(join(directory, sheet.file), renderSheet(sheet));
    console.log(`${PREVIEW_DIR}/${sheet.file}`);
  };
  for (const spec of selected) {
    const rows = spec.rows();
    allRows.push(...rows);
    emit({ file: spec.file, rows });
  }
  if (args.length === 0) {
    emit({ file: 'contact-sheet.png', rows: allRows });
    console.log(`Manifest assets: ${Object.keys(BRAND_ASSETS).length}`);
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
