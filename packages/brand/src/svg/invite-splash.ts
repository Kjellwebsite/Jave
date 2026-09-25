/**
 * The Discord invite splash (1920×1080).
 *
 * Discord scales the splash to cover the browser window (CSS `cover`: scaled
 * until both sides fill the window, centred, overflow cropped) and centres the
 * invite card over it. So what stays visible depends on the window: narrow
 * aspect ratios (16:10, 4:3) crop the sides, small windows let the card cover
 * more of the image. The brand block is placed in the region that stays
 * visible and clear of the card on every supported viewport; a faint emblem
 * watermark bleeding off the right edge balances it.
 */
import { BRAND_COLORS } from '../colors';
import { emblemSilhouette } from './emblem-art';
import { stackedLockup, stackedLockupBox } from './lockups';
import {
  backdrop,
  divider,
  motto,
  mottoBox,
  type Box,
  type DividerSpec,
  type MottoDisplay,
} from './scene-parts';
import type { BrandTypography } from './typography';
import { combine, el, fragment, svgDocument } from './xml';

export const INVITE_SPLASH_SIZE = { width: 1920, height: 1080 } as const;

export interface Viewport {
  readonly label: string;
  /** Browser window content size, CSS px. */
  readonly width: number;
  readonly height: number;
}

/**
 * Windows the splash is laid out for: common desktop and tablet-landscape
 * viewports from 4:3 to 21:9, down to 1280 px wide. Portrait phones are out of
 * scope — there the card covers the whole centre of any splash.
 */
export const INVITE_SPLASH_VIEWPORTS: readonly Viewport[] = [
  { label: '16:9 1920x1080', width: 1920, height: 1080 },
  { label: '16:9 1366x768', width: 1366, height: 768 },
  { label: '16:9 1280x720', width: 1280, height: 720 },
  { label: '16:10 1440x900', width: 1440, height: 900 },
  { label: '16:10 1280x800', width: 1280, height: 800 },
  { label: '4:3 1024x768', width: 1024, height: 768 },
  { label: 'tablet landscape 1180x820', width: 1180, height: 820 },
  { label: '21:9 2560x1080', width: 2560, height: 1080 },
];

/** Width of Discord's invite card, CSS px. */
export const INVITE_CARD_WIDTH_PX = 480;

/** Space kept between the brand block and a crop edge or the card, splash px. */
export const INVITE_SPLASH_CLEARANCE = 16;

export interface CoverView {
  readonly viewport: Viewport;
  /** Display pixels per splash pixel. */
  readonly scale: number;
  /** The part of the splash inside the window. */
  readonly visible: Box;
  /** Left edge of the invite card. */
  readonly cardLeft: number;
}

/** What a viewport shows of the splash under Discord's cover scaling. */
export function coverView(viewport: Viewport): CoverView {
  const { width, height } = INVITE_SPLASH_SIZE;
  const scale = Math.max(viewport.width / width, viewport.height / height);
  const cropX = (width - viewport.width / scale) / 2;
  const cropY = (height - viewport.height / scale) / 2;
  return {
    viewport,
    scale,
    visible: { left: cropX, top: cropY, right: width - cropX, bottom: height - cropY },
    cardLeft: width / 2 - INVITE_CARD_WIDTH_PX / 2 / scale,
  };
}

/** The region visible and left of the card on every supported viewport. */
export function inviteSplashSafeZone(): Box {
  const views = INVITE_SPLASH_VIEWPORTS.map(coverView);
  return {
    left: Math.max(...views.map((view) => view.visible.left)),
    top: Math.max(...views.map((view) => view.visible.top)),
    right: Math.min(...views.map((view) => view.cardLeft)),
    bottom: Math.min(...views.map((view) => view.visible.bottom)),
  };
}

/** Smallest display scale of the splash across the supported viewports. */
export function inviteSplashMinScale(): number {
  return Math.min(...INVITE_SPLASH_VIEWPORTS.map((viewport) => coverView(viewport).scale));
}

interface SplashLayout {
  readonly emblemHeight: number;
  /** From the wordmark's baseline to the divider. */
  readonly dividerGap: number;
  readonly divider: DividerSpec;
  /** From the divider to the top of the motto's capitals. */
  readonly mottoGap: number;
  readonly mottoCapHeight: number;
  readonly watermark: {
    readonly centerX: number;
    readonly centerY: number;
    readonly radius: number;
    readonly opacity: number;
  };
}

const SPLASH: SplashLayout = {
  emblemHeight: 200,
  dividerGap: 28,
  divider: { length: 72, thickness: 1.5 },
  mottoGap: 26,
  mottoCapHeight: 12,
  watermark: { centerX: 1600, centerY: 590, radius: 520, opacity: 0.03 },
};

/**
 * The splash motto on the supported viewport that shows it smallest, judged
 * on a standard-density (1×) screen.
 */
export function inviteSplashMottoDisplay(): MottoDisplay {
  return {
    context: 'smallest supported window, 1× screen',
    capHeight: SPLASH.mottoCapHeight,
    scale: inviteSplashMinScale(),
    pixelRatio: 1,
  };
}

interface BrandBlock {
  readonly box: Box;
  readonly centerX: number;
  readonly dividerY: number;
  readonly mottoTop: number;
}

/** The brand column (lockup, divider, motto), centred in the safe zone. */
function brandBlock(typography: BrandTypography): BrandBlock {
  const zone = inviteSplashSafeZone();
  const lockup = stackedLockupBox(typography, SPLASH.emblemHeight);
  const mottoSize = mottoBox(typography, SPLASH.mottoCapHeight);
  const height = lockup.height + SPLASH.dividerGap + SPLASH.mottoGap + mottoSize.height;
  const halfWidth = Math.max(lockup.width, mottoSize.width, SPLASH.divider.length) / 2;
  const centerX = (zone.left + zone.right) / 2;
  const top = (zone.top + zone.bottom - height) / 2;
  const dividerY = top + lockup.height + SPLASH.dividerGap;
  return {
    box: { left: centerX - halfWidth, top, right: centerX + halfWidth, bottom: top + height },
    centerX,
    dividerY,
    mottoTop: dividerY + SPLASH.mottoGap,
  };
}

/** Where the brand block lands on the splash, splash px. */
export function inviteSplashBrandBox(typography: BrandTypography): Box {
  return brandBlock(typography).box;
}

export function inviteSplashSvg(typography: BrandTypography): string {
  const { width, height } = INVITE_SPLASH_SIZE;
  const block = brandBlock(typography);
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
        centerX: block.centerX,
        top: block.box.top,
        emblemHeight: SPLASH.emblemHeight,
      }),
      divider('splash-divider', block.centerX, block.dividerY, SPLASH.divider),
      motto(typography, {
        centerX: block.centerX,
        top: block.mottoTop,
        capHeight: SPLASH.mottoCapHeight,
      }),
    ),
  });
}
