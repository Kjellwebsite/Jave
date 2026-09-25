/**
 * Square icons: the emblem files, the Discord server icon (flagship), the bot
 * avatar, the favicon and the touch icon.
 */
import { BRAND_COLORS, METAL_TONES } from '../colors';
import { EMBLEM_UNITS } from '../emblem-metrics';
import { EMBLEM_FINISHES, emblemArt, emblemSilhouette, placementCentered } from './emblem-art';
import { VERTICAL, linearGradient } from './paint';
import {
  ALUMINIUM_PLATE,
  GRAPHITE_PLATE,
  plateArt,
  type PlateLayout,
  type PlateMaterial,
} from './plates';
import { combine, el, fragment, svgDocument, url, type Fragment } from './xml';

/** Emblem files open at this size; the artwork itself is resolution independent. */
const EMBLEM_DISPLAY_SIZE = 512;

/** Plates are designed on a 1024 canvas and scaled for smaller outputs. */
export const PLATE_CANVAS = 1024;

/**
 * Padded, circle-safe plate: the rounded corners stay inside the circle Discord
 * crops server icons and avatars to, with room for the cast shadow.
 */
export const PADDED_PLATE_LAYOUT: PlateLayout = {
  size: PLATE_CANVAS,
  inset: 104,
  cornerRadius: 196,
  rimWidth: 12,
  emblemRadius: 316,
  emblemLift: 12,
};

/** Full-bleed plate for hosts that apply their own mask (iOS touch icons). */
export const FULL_BLEED_PLATE_LAYOUT: PlateLayout = {
  size: PLATE_CANVAS,
  inset: 0,
  cornerRadius: 0,
  rimWidth: 0,
  emblemRadius: 330,
  emblemLift: 12,
};

export interface PlateIconSpec {
  readonly layout: PlateLayout;
  readonly material: PlateMaterial;
}

/** How each plate icon in the manifest is built. */
export const PLATE_ICONS = {
  'server-icon': { layout: PADDED_PLATE_LAYOUT, material: ALUMINIUM_PLATE },
  'bot-avatar': { layout: PADDED_PLATE_LAYOUT, material: GRAPHITE_PLATE },
  'apple-touch-icon': { layout: FULL_BLEED_PLATE_LAYOUT, material: ALUMINIUM_PLATE },
} as const satisfies Record<string, PlateIconSpec>;

export type PlateIconId = keyof typeof PLATE_ICONS;

function plateIconArt(id: PlateIconId, prefix: string): Fragment {
  const { layout, material } = PLATE_ICONS[id];
  return plateArt(prefix, layout, material);
}

export function emblemSvg(): string {
  return svgDocument({
    width: EMBLEM_DISPLAY_SIZE,
    height: EMBLEM_DISPLAY_SIZE,
    viewBox: `0 0 ${EMBLEM_UNITS} ${EMBLEM_UNITS}`,
    title: 'JAVELIN emblem',
    content: emblemArt({ id: 'emblem', finish: EMBLEM_FINISHES.metallic }),
  });
}

export function emblemOnLightSvg(): string {
  return svgDocument({
    width: EMBLEM_DISPLAY_SIZE,
    height: EMBLEM_DISPLAY_SIZE,
    viewBox: `0 0 ${EMBLEM_UNITS} ${EMBLEM_UNITS}`,
    title: 'JAVELIN emblem (for light backgrounds)',
    content: emblemArt({ id: 'emblem', finish: EMBLEM_FINISHES.onLight }),
  });
}

export function emblemMonoSvg(): string {
  return svgDocument({
    width: EMBLEM_DISPLAY_SIZE,
    height: EMBLEM_DISPLAY_SIZE,
    viewBox: `0 0 ${EMBLEM_UNITS} ${EMBLEM_UNITS}`,
    title: 'JAVELIN emblem (monochrome)',
    content: emblemSilhouette(),
  });
}

export function serverIconSvg(): string {
  return svgDocument({
    width: PLATE_CANVAS,
    height: PLATE_CANVAS,
    title: 'JAVELIN server icon',
    content: plateIconArt('server-icon', 'icon'),
  });
}

export function botAvatarSvg(): string {
  return svgDocument({
    width: PLATE_CANVAS,
    height: PLATE_CANVAS,
    title: 'JAVE bot avatar',
    content: plateIconArt('bot-avatar', 'avatar'),
  });
}

/** Apple touch icon size (px). */
export const APPLE_TOUCH_ICON_SIZE = 180;

export function appleTouchIconSvg(): string {
  return svgDocument({
    width: APPLE_TOUCH_ICON_SIZE,
    height: APPLE_TOUCH_ICON_SIZE,
    viewBox: `0 0 ${PLATE_CANVAS} ${PLATE_CANVAS}`,
    title: 'JAVELIN',
    content: plateIconArt('apple-touch-icon', 'touch'),
  });
}

/** The favicon is drawn on a 32-unit grid: flat graphite tile, no filters. */
const FAVICON_UNITS = 32;
const FAVICON_CORNER_RADIUS = 7;
const FAVICON_EMBLEM_RADIUS = 14;
/** Optical lift of the emblem on the favicon tile, in favicon units. */
const FAVICON_EMBLEM_LIFT = 0.4;
const FAVICON_RIM_WIDTH = 1;
const FAVICON_RIM_OPACITY = 0.16;

export function faviconSvg(): string {
  const tileId = 'favicon-tile';
  const rimId = 'favicon-rim';
  const half = FAVICON_RIM_WIDTH / 2;
  const tile = fragment(
    [
      linearGradient(tileId, VERTICAL, [
        { offset: 0, color: METAL_TONES.graphiteLift },
        { offset: 1, color: METAL_TONES.graphiteDeep },
      ]),
      linearGradient(rimId, VERTICAL, [
        { offset: 0, color: BRAND_COLORS.white, opacity: FAVICON_RIM_OPACITY },
        { offset: 0.5, color: BRAND_COLORS.white, opacity: 0 },
      ]),
    ],
    [
      el('rect', {
        width: FAVICON_UNITS,
        height: FAVICON_UNITS,
        rx: FAVICON_CORNER_RADIUS,
        fill: url(tileId),
      }),
      el('rect', {
        x: half,
        y: half,
        width: FAVICON_UNITS - FAVICON_RIM_WIDTH,
        height: FAVICON_UNITS - FAVICON_RIM_WIDTH,
        rx: FAVICON_CORNER_RADIUS - half,
        fill: 'none',
        stroke: url(rimId),
        'stroke-width': FAVICON_RIM_WIDTH,
      }),
    ],
  );
  const emblem = emblemArt({
    id: 'favicon-emblem',
    finish: EMBLEM_FINISHES.metallic,
    placement: placementCentered(
      { x: FAVICON_UNITS / 2, y: FAVICON_UNITS / 2 - FAVICON_EMBLEM_LIFT },
      FAVICON_EMBLEM_RADIUS,
    ),
  });
  return svgDocument({
    width: FAVICON_UNITS,
    height: FAVICON_UNITS,
    title: 'JAVELIN',
    content: combine(tile, emblem),
  });
}
