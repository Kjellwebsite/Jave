/**
 * Wide compositions: the Discord server banner and the Open Graph image
 * (the invite splash lives in `invite-splash.ts`). Graphite field, a centred
 * lockup, a short machined divider and the motto on two lines. No glow.
 */
import { inviteSplashMottoDisplay } from './invite-splash';
import { horizontalLockup, horizontalLockupBox } from './lockups';
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
import { combine, svgDocument, type Fragment } from './xml';

export const SERVER_BANNER_SIZE = { width: 960, height: 540 } as const;
/** Discord's desktop channel sidebar draws the banner this wide, CSS px. */
export const SERVER_BANNER_SIDEBAR_WIDTH = 240;
/** Discord's mobile channel list draws the banner about this wide, CSS px (pt). */
export const SERVER_BANNER_MOBILE_WIDTH = 320;
/**
 * Top band of the banner, canvas px, that Discord covers with the server name
 * header (48 of the 135 px the sidebar shows). The composition stays below it.
 */
export const SERVER_BANNER_NAME_BAND = 192;

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
/**
 * Discord link embeds draw `og:image` at most this wide, CSS px; most other
 * hosts draw it larger. The motto is sized for this width.
 */
export const OG_IMAGE_EMBED_WIDTH = 400;

/** Common device pixel ratios: a high-density desktop screen, a modern phone. */
const DESKTOP_HIGH_DENSITY = 2;
const PHONE_DENSITY = 3;

/** A vertical span of the canvas, canvas px. */
export interface Band {
  readonly top: number;
  readonly bottom: number;
}

/** A centred horizontal lockup over a short machined divider and the two-line motto. */
interface LockupMottoLayout {
  readonly emblemHeight: number;
  /** From the bottom of the lockup to the divider. */
  readonly dividerGap: number;
  readonly divider: DividerSpec;
  /** From the divider to the top of the motto's capitals. */
  readonly mottoGap: number;
  readonly mottoCapHeight: number;
  /** The block is centred vertically in this band. */
  readonly band: Band;
}

/** Height of the stack, from the top of the emblem to the motto's last baseline. */
function stackHeight(typography: BrandTypography, layout: LockupMottoLayout): number {
  return (
    layout.emblemHeight +
    layout.dividerGap +
    layout.mottoGap +
    mottoBox(typography, layout.mottoCapHeight).height
  );
}

function stackBox(
  typography: BrandTypography,
  layout: LockupMottoLayout,
  canvasWidth: number,
): Box {
  const height = stackHeight(typography, layout);
  const top = (layout.band.top + layout.band.bottom - height) / 2;
  const halfWidth =
    Math.max(
      horizontalLockupBox(typography, layout.emblemHeight).width,
      mottoBox(typography, layout.mottoCapHeight).width,
      layout.divider.length,
    ) / 2;
  const centerX = canvasWidth / 2;
  return { left: centerX - halfWidth, top, right: centerX + halfWidth, bottom: top + height };
}

function lockupOverMotto(
  id: string,
  typography: BrandTypography,
  layout: LockupMottoLayout,
  canvasWidth: number,
): Fragment {
  const box = horizontalLockupBox(typography, layout.emblemHeight);
  const { top } = stackBox(typography, layout, canvasWidth);
  const centerX = canvasWidth / 2;
  const dividerY = top + box.height + layout.dividerGap;
  return combine(
    horizontalLockup({
      id,
      typography,
      tone: 'dark',
      left: centerX - box.width / 2,
      top,
      emblemHeight: layout.emblemHeight,
    }),
    divider(`${id}-divider`, centerX, dividerY, layout.divider),
    motto(typography, {
      centerX,
      top: dividerY + layout.mottoGap,
      capHeight: layout.mottoCapHeight,
    }),
  );
}

/**
 * Sits in the band below Discord's name header. The motto is as large as it
 * can be while staying narrower than the lockup.
 */
const BANNER: LockupMottoLayout = {
  emblemHeight: 140,
  dividerGap: 32,
  divider: { length: 88, thickness: 1.5 },
  mottoGap: 26,
  mottoCapHeight: 18,
  band: { top: SERVER_BANNER_NAME_BAND, bottom: SERVER_BANNER_SIZE.height },
};

const OG: LockupMottoLayout = {
  emblemHeight: 170,
  dividerGap: 44,
  divider: { length: 96, thickness: 1.5 },
  mottoGap: 34,
  mottoCapHeight: 24,
  band: { top: 0, bottom: OG_IMAGE_SIZE.height },
};

export function serverBannerSvg(typography: BrandTypography): string {
  const { width, height } = SERVER_BANNER_SIZE;
  return svgDocument({
    width,
    height,
    title: 'JAVELIN server banner',
    content: combine(
      backdrop('banner', width, height),
      lockupOverMotto('banner', typography, BANNER, width),
    ),
  });
}

export function ogImageSvg(typography: BrandTypography): string {
  const { width, height } = OG_IMAGE_SIZE;
  return svgDocument({
    width,
    height,
    title: 'JAVELIN',
    content: combine(backdrop('og', width, height), lockupOverMotto('og', typography, OG, width)),
  });
}

/** Where the banner's brand block lands, canvas px. */
export function serverBannerBlockBox(typography: BrandTypography): Box {
  return stackBox(typography, BANNER, SERVER_BANNER_SIZE.width);
}

/** Where the Open Graph brand block lands, canvas px. */
export function ogImageBlockBox(typography: BrandTypography): Box {
  return stackBox(typography, OG, OG_IMAGE_SIZE.width);
}

/** Width of the banner's lockup and of its motto, canvas px. */
export function serverBannerWidths(typography: BrandTypography): {
  readonly lockup: number;
  readonly motto: number;
} {
  return {
    lockup: horizontalLockupBox(typography, BANNER.emblemHeight).width,
    motto: mottoBox(typography, BANNER.mottoCapHeight).width,
  };
}

export type SceneId = 'server-banner' | 'invite-splash' | 'og-image';

/**
 * Every context each scene's motto is sized to read in. One context is
 * deliberately missing: the banner in the desktop sidebar on a standard-
 * density (1×) screen, where it is 4.5 px tall and the lockup carries the
 * banner (README → Minimum sizes).
 */
export function sceneMottoDisplays(): Readonly<Record<SceneId, readonly MottoDisplay[]>> {
  const { width: bannerWidth } = SERVER_BANNER_SIZE;
  return {
    'server-banner': [
      {
        context: `desktop sidebar (${SERVER_BANNER_SIDEBAR_WIDTH} px), 2× screen`,
        capHeight: BANNER.mottoCapHeight,
        scale: SERVER_BANNER_SIDEBAR_WIDTH / bannerWidth,
        pixelRatio: DESKTOP_HIGH_DENSITY,
      },
      {
        context: `mobile channel list (${SERVER_BANNER_MOBILE_WIDTH} pt), 3× phone`,
        capHeight: BANNER.mottoCapHeight,
        scale: SERVER_BANNER_MOBILE_WIDTH / bannerWidth,
        pixelRatio: PHONE_DENSITY,
      },
    ],
    'invite-splash': [inviteSplashMottoDisplay()],
    'og-image': [
      {
        context: `Discord link embed (${OG_IMAGE_EMBED_WIDTH} px), 1× screen`,
        capHeight: OG.mottoCapHeight,
        scale: OG_IMAGE_EMBED_WIDTH / OG_IMAGE_SIZE.width,
        pixelRatio: 1,
      },
    ],
  };
}

/** The banner motto in the one context it is not sized for (see `sceneMottoDisplays`). */
export function serverBannerSidebarStandardDensity(): MottoDisplay {
  return {
    context: `desktop sidebar (${SERVER_BANNER_SIDEBAR_WIDTH} px), 1× screen`,
    capHeight: BANNER.mottoCapHeight,
    scale: SERVER_BANNER_SIDEBAR_WIDTH / SERVER_BANNER_SIZE.width,
    pixelRatio: 1,
  };
}
