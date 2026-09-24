/**
 * Wide compositions: the Discord server banner and invite splash, and the
 * Open Graph image. Graphite field, restrained brushed-metal rails, emblem,
 * wordmark and motto. No glow.
 */
import { BRAND_COLORS, METAL_TONES } from '../colors';
import { emblemSilhouette } from './emblem-art';
import { horizontalLockup, horizontalLockupBox, stackedLockup, stackedLockupBox } from './lockups';
import {
  BRUSHED_METAL_GRAIN,
  VERTICAL,
  brushedGrainFilter,
  linearGradient,
  type GradientStop,
  type GrainOptions,
} from './paint';
import { placeText, textWidth, type BrandTypography } from './typography';
import { combine, el, fragment, svgDocument, url, type Fragment } from './xml';

const BACKDROP_STOPS: readonly GradientStop[] = [
  { offset: 0, color: METAL_TONES.graphiteMid },
  { offset: 0.55, color: BRAND_COLORS.graphite },
  { offset: 1, color: METAL_TONES.graphiteDeep },
];

/** Edge darkening that frames the field without drawing a border. */
const VIGNETTE_OPACITY = 0.45;
const VIGNETTE_INNER_OFFSET = 0.55;
/** Vignette radius as a fraction of the frame (objectBoundingBox), centred. */
const VIGNETTE_RADIUS = 0.75;
const FRAME_CENTER = 0.5;

/**
 * Faint brushing across the whole field: reads as dark brushed titanium up
 * close, and dithers the gradients so they never band in 8-bit output.
 */
const FIELD_GRAIN: GrainOptions & { readonly opacity: number } = {
  ...BRUSHED_METAL_GRAIN,
  seed: 7,
  opacity: 0.025,
};

function backdrop(id: string, width: number, height: number): Fragment {
  const fieldId = `${id}-field`;
  const vignetteId = `${id}-vignette`;
  const grainId = `${id}-grain`;
  return fragment(
    [
      linearGradient(fieldId, VERTICAL, BACKDROP_STOPS),
      el(
        'radialGradient',
        { id: vignetteId, cx: FRAME_CENTER, cy: FRAME_CENTER, r: VIGNETTE_RADIUS },
        el('stop', {
          offset: VIGNETTE_INNER_OFFSET,
          'stop-color': BRAND_COLORS.black,
          'stop-opacity': 0,
        }),
        el('stop', {
          offset: 1,
          'stop-color': BRAND_COLORS.black,
          'stop-opacity': VIGNETTE_OPACITY,
        }),
      ),
      brushedGrainFilter(grainId, FIELD_GRAIN),
    ],
    [
      el('rect', { width, height, fill: url(fieldId) }),
      el('rect', { width, height, fill: url(vignetteId) }),
      el('rect', {
        width,
        height,
        fill: BRAND_COLORS.black,
        filter: url(grainId),
        opacity: FIELD_GRAIN.opacity,
      }),
    ],
  );
}

export interface RailSpec {
  /** Length of each rail, output units. */
  readonly length: number;
  /** Thickness of the bright upper edge; the shaded lower edge matches it. */
  readonly thickness: number;
  /** Space between the motto and the rail's inner end. */
  readonly gap: number;
}

/** Peak opacity of a rail's chrome upper edge and steel lower edge. */
const RAIL_UPPER_OPACITY = 0.85;
const RAIL_LOWER_OPACITY = 0.6;

const RAIL_EDGES = [
  { edge: 'upper', color: BRAND_COLORS.chrome, opacity: RAIL_UPPER_OPACITY, above: true },
  { edge: 'lower', color: BRAND_COLORS.steel, opacity: RAIL_LOWER_OPACITY, above: false },
] as const;

/**
 * One machined bar from `from` to `to` (x), its chrome upper edge over a steel
 * lower edge, sitting on `y`. `stops` shape the fade along its length.
 */
function bar(
  id: string,
  from: number,
  to: number,
  y: number,
  thickness: number,
  fade: (peak: number) => readonly GradientStop[],
): Fragment {
  const defs: string[] = [];
  const body: string[] = [];
  for (const edge of RAIL_EDGES) {
    const gradientId = `${id}-${edge.edge}`;
    defs.push(
      linearGradient(
        gradientId,
        { x1: from, y1: 0, x2: to, y2: 0, units: 'userSpaceOnUse' },
        fade(edge.opacity).map((stop) => ({ ...stop, color: edge.color })),
      ),
    );
    body.push(
      el('rect', {
        x: Math.min(from, to),
        y: edge.above ? y - thickness : y,
        width: Math.abs(to - from),
        height: thickness,
        fill: url(gradientId),
      }),
    );
  }
  return fragment(defs, body);
}

/** Full strength at the start, fading out toward the end. */
function fadeOut(peak: number): GradientStop[] {
  return [
    { offset: 0, color: BRAND_COLORS.white, opacity: peak },
    { offset: 1, color: BRAND_COLORS.white, opacity: 0 },
  ];
}

/** Full strength in the middle, fading out toward both ends. */
function fadeBothEnds(peak: number): GradientStop[] {
  return [
    { offset: 0, color: BRAND_COLORS.white, opacity: 0 },
    { offset: 0.5, color: BRAND_COLORS.white, opacity: peak },
    { offset: 1, color: BRAND_COLORS.white, opacity: 0 },
  ];
}

/** A pair of rails flanking a centred element, fading out toward the outside. */
function rails(
  id: string,
  centerX: number,
  centerY: number,
  clearHalfWidth: number,
  rail: RailSpec,
): Fragment {
  const leftInner = centerX - clearHalfWidth - rail.gap;
  const rightInner = centerX + clearHalfWidth + rail.gap;
  return combine(
    bar(`${id}-left`, leftInner, leftInner - rail.length, centerY, rail.thickness, fadeOut),
    bar(`${id}-right`, rightInner, rightInner + rail.length, centerY, rail.thickness, fadeOut),
  );
}

export interface DividerSpec {
  /** Length of the divider, output units. */
  readonly length: number;
  readonly thickness: number;
  /** Space between the divider and the top of the motto's capitals. */
  readonly gap: number;
}

/** How the motto is set off: flanking rails, or a short divider above it. */
export type MottoAccent =
  | { readonly kind: 'rails'; readonly rail: RailSpec }
  | { readonly kind: 'divider'; readonly divider: DividerSpec };

interface MottoSpec {
  readonly centerX: number;
  readonly baselineY: number;
  readonly capHeight: number;
  readonly accent: MottoAccent;
}

function mottoAccent(id: string, spec: MottoSpec, halfWidth: number): Fragment {
  const { accent } = spec;
  if (accent.kind === 'rails') {
    const railY = spec.baselineY - spec.capHeight / 2 + accent.rail.thickness;
    return rails(`${id}-rail`, spec.centerX, railY, halfWidth, accent.rail);
  }
  const { divider } = accent;
  const y = spec.baselineY - spec.capHeight - divider.gap;
  const half = divider.length / 2;
  return bar(
    `${id}-divider`,
    spec.centerX - half,
    spec.centerX + half,
    y,
    divider.thickness,
    fadeBothEnds,
  );
}

function motto(id: string, typography: BrandTypography, spec: MottoSpec): Fragment {
  const halfWidth = textWidth(typography.motto, spec.capHeight) / 2;
  return combine(
    fragment(
      [],
      [
        placeText(typography.motto, {
          x: spec.centerX,
          baselineY: spec.baselineY,
          capHeight: spec.capHeight,
          align: 'center',
          fill: BRAND_COLORS.aluminium,
        }),
      ],
    ),
    mottoAccent(id, spec, halfWidth),
  );
}

/** Half the width of the motto including its accent. */
function mottoHalfExtent(
  typography: BrandTypography,
  capHeight: number,
  accent: MottoAccent,
): number {
  const text = textWidth(typography.motto, capHeight) / 2;
  return accent.kind === 'rails'
    ? text + accent.rail.gap + accent.rail.length
    : Math.max(text, accent.divider.length / 2);
}

export const SERVER_BANNER_SIZE = { width: 960, height: 540 } as const;
export const INVITE_SPLASH_SIZE = { width: 1920, height: 1080 } as const;
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/** A centred horizontal lockup over the motto. */
interface WideLayout {
  readonly emblemHeight: number;
  readonly lockupCenterY: number;
  readonly mottoBaselineY: number;
  readonly mottoCapHeight: number;
  readonly accent: MottoAccent;
}

/**
 * Discord overlays the server name across the top of the banner, so the
 * composition sits in the lower part of the frame.
 */
const BANNER: WideLayout = {
  emblemHeight: 150,
  lockupCenterY: 290,
  mottoBaselineY: 432,
  mottoCapHeight: 12,
  accent: { kind: 'rails', rail: { length: 150, thickness: 1.5, gap: 22 } },
};

export function serverBannerSvg(typography: BrandTypography): string {
  const { width, height } = SERVER_BANNER_SIZE;
  const box = horizontalLockupBox(typography, BANNER.emblemHeight);
  return svgDocument({
    width,
    height,
    title: 'JAVELIN server banner',
    content: combine(
      backdrop('banner', width, height),
      horizontalLockup({
        id: 'banner',
        typography,
        tone: 'dark',
        left: (width - box.width) / 2,
        top: BANNER.lockupCenterY - box.height / 2,
        emblemHeight: BANNER.emblemHeight,
      }),
      motto('banner-motto', typography, {
        centerX: width / 2,
        baselineY: BANNER.mottoBaselineY,
        capHeight: BANNER.mottoCapHeight,
        accent: BANNER.accent,
      }),
    ),
  });
}

/**
 * The invite card covers the middle of the splash — and more of it on smaller
 * screens, because Discord scales the splash to cover the window — so the
 * brand stays inside the left ~30% and a faint emblem watermark, bleeding off
 * the right edge, balances it.
 */
interface SplashLayout {
  readonly emblemHeight: number;
  readonly columnCenterX: number;
  readonly blockTop: number;
  readonly mottoGap: number;
  readonly mottoCapHeight: number;
  readonly accent: MottoAccent;
  readonly watermark: {
    readonly centerX: number;
    readonly centerY: number;
    readonly radius: number;
    readonly opacity: number;
  };
}

const SPLASH: SplashLayout = {
  emblemHeight: 230,
  columnCenterX: 320,
  blockTop: 330,
  mottoGap: 64,
  mottoCapHeight: 11,
  accent: { kind: 'divider', divider: { length: 72, thickness: 1.5, gap: 26 } },
  watermark: { centerX: 1600, centerY: 590, radius: 520, opacity: 0.03 },
};

/**
 * Right edge, in splash pixels, of the area the invite card leaves visible:
 * Discord scales the splash to cover the window, so on a 1280px-wide window
 * the ~480px card starts about 600px into the image.
 */
export const INVITE_SPLASH_SAFE_RIGHT = 600;

export interface HorizontalExtent {
  readonly left: number;
  readonly right: number;
}

/** Horizontal extent of the splash's brand block (lockup, motto and rails). */
export function inviteSplashBrandExtent(typography: BrandTypography): HorizontalExtent {
  const lockup = stackedLockupBox(typography, SPLASH.emblemHeight);
  const half = Math.max(
    lockup.width / 2,
    mottoHalfExtent(typography, SPLASH.mottoCapHeight, SPLASH.accent),
  );
  return { left: SPLASH.columnCenterX - half, right: SPLASH.columnCenterX + half };
}

export function inviteSplashSvg(typography: BrandTypography): string {
  const { width, height } = INVITE_SPLASH_SIZE;
  const lockup = stackedLockupBox(typography, SPLASH.emblemHeight);
  const watermark = emblemSilhouette(
    {
      center: { x: SPLASH.watermark.centerX, y: SPLASH.watermark.centerY },
      radius: SPLASH.watermark.radius,
    },
    BRAND_COLORS.white,
  );
  return svgDocument({
    width,
    height,
    title: 'JAVELIN invite splash',
    content: combine(
      backdrop('splash', width, height),
      fragment([], [el('g', { opacity: SPLASH.watermark.opacity }, ...watermark.body)]),
      stackedLockup({
        id: 'splash',
        typography,
        tone: 'dark',
        centerX: SPLASH.columnCenterX,
        top: SPLASH.blockTop,
        emblemHeight: SPLASH.emblemHeight,
      }),
      motto('splash-motto', typography, {
        centerX: SPLASH.columnCenterX,
        baselineY: SPLASH.blockTop + lockup.height + SPLASH.mottoGap,
        capHeight: SPLASH.mottoCapHeight,
        accent: SPLASH.accent,
      }),
    ),
  });
}

const OG: WideLayout = {
  emblemHeight: 170,
  lockupCenterY: 280,
  mottoBaselineY: 455,
  mottoCapHeight: 14,
  accent: { kind: 'rails', rail: { length: 170, thickness: 1.5, gap: 26 } },
};

export function ogImageSvg(typography: BrandTypography): string {
  const { width, height } = OG_IMAGE_SIZE;
  const box = horizontalLockupBox(typography, OG.emblemHeight);
  return svgDocument({
    width,
    height,
    title: 'JAVELIN',
    content: combine(
      backdrop('og', width, height),
      horizontalLockup({
        id: 'og',
        typography,
        tone: 'dark',
        left: (width - box.width) / 2,
        top: OG.lockupCenterY - box.height / 2,
        emblemHeight: OG.emblemHeight,
      }),
      motto('og-motto', typography, {
        centerX: width / 2,
        baselineY: OG.mottoBaselineY,
        capHeight: OG.mottoCapHeight,
        accent: OG.accent,
      }),
    ),
  });
}
