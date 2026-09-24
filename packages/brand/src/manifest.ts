/**
 * Typed inventory of every committed brand asset. Paths are relative to the
 * package root (`packages/brand`). `scripts/render.ts` writes exactly these
 * files; the test suite checks that each one exists and matches its size.
 */
import type { RoleIconKey } from './role-marks';

export interface BrandRaster {
  readonly path: string;
  readonly width: number;
  readonly height: number;
}

export interface BrandAsset {
  /** Vector source (the master). */
  readonly svg: string;
  /** PNG renders of the master, largest first. */
  readonly rasters: readonly BrandRaster[];
  readonly usage: string;
}

const SVG_DIR = 'assets/svg';
const PNG_DIR = 'assets/png';

function svg(name: string): string {
  return `${SVG_DIR}/${name}.svg`;
}

function png(name: string, width: number, height: number = width): BrandRaster {
  return { path: `${PNG_DIR}/${name}.png`, width, height };
}

/** Discord role icons must be at least 64×64. */
const ROLE_ICON_SIZE = 64;

function roleAsset(key: RoleIconKey): BrandAsset {
  return {
    svg: svg(`role-${key}`),
    rasters: [png(`role-${key}-${ROLE_ICON_SIZE}`, ROLE_ICON_SIZE)],
    usage: `Discord role icon for ${key.toUpperCase()}. Upload the 64px PNG.`,
  };
}

export const BRAND_ASSETS = {
  emblem: {
    svg: svg('emblem'),
    rasters: [png('emblem-512', 512)],
    usage: 'Two-tone metallic emblem on transparent. For dark surfaces.',
  },
  'emblem-on-light': {
    svg: svg('emblem-on-light'),
    rasters: [png('emblem-on-light-512', 512)],
    usage: 'Graphite and steel emblem on transparent. For light surfaces.',
  },
  'emblem-mono': {
    svg: svg('emblem-mono'),
    rasters: [],
    usage: 'Single-colour silhouette using currentColor. Masks, embossing, one-colour print.',
  },
  'server-icon': {
    svg: svg('server-icon'),
    rasters: [
      png('server-icon-1024', 1024),
      png('server-icon-512', 512),
      png('server-icon-256', 256),
      png('server-icon-128', 128),
    ],
    usage: 'Discord server icon. Upload the 1024 master; circle-safe.',
  },
  'bot-avatar': {
    svg: svg('bot-avatar'),
    rasters: [png('bot-avatar-1024', 1024), png('bot-avatar-512', 512)],
    usage: 'JAVE bot avatar (Discord Developer Portal → Bot). Circle-safe.',
  },
  favicon: {
    svg: svg('favicon'),
    rasters: [png('favicon-32', 32), png('favicon-16', 16)],
    usage: 'Dashboard and Activity favicon. Serve the SVG with PNG fallbacks.',
  },
  'apple-touch-icon': {
    svg: svg('apple-touch-icon'),
    rasters: [png('apple-touch-icon-180', 180)],
    usage: 'iOS home-screen icon. Full-bleed; iOS applies the mask.',
  },
  wordmark: {
    svg: svg('wordmark'),
    rasters: [],
    usage: 'JAVELIN wordmark, outlined Orbitron, chrome. For dark surfaces.',
  },
  'wordmark-on-light': {
    svg: svg('wordmark-on-light'),
    rasters: [],
    usage: 'Graphite wordmark for light surfaces.',
  },
  'wordmark-mono': {
    svg: svg('wordmark-mono'),
    rasters: [],
    usage: 'Wordmark using currentColor, for inline use in UI.',
  },
  lockup: {
    svg: svg('lockup'),
    rasters: [],
    usage: 'Horizontal lockup: emblem and wordmark. For dark surfaces.',
  },
  'lockup-on-light': {
    svg: svg('lockup-on-light'),
    rasters: [],
    usage: 'Horizontal lockup for light surfaces.',
  },
  'lockup-stacked': {
    svg: svg('lockup-stacked'),
    rasters: [],
    usage: 'Stacked lockup: emblem above wordmark. For dark surfaces.',
  },
  'lockup-stacked-on-light': {
    svg: svg('lockup-stacked-on-light'),
    rasters: [],
    usage: 'Stacked lockup for light surfaces.',
  },
  'server-banner': {
    svg: svg('server-banner'),
    rasters: [png('server-banner-960x540', 960, 540)],
    usage: 'Discord server banner (16:9).',
  },
  'invite-splash': {
    svg: svg('invite-splash'),
    rasters: [png('invite-splash-1920x1080', 1920, 1080)],
    usage: 'Discord invite splash (16:9). The invite card covers the centre.',
  },
  'og-image': {
    svg: svg('og-image'),
    rasters: [png('og-image-1200x630', 1200, 630)],
    usage: 'Open Graph / Twitter card image for the dashboard and public profiles.',
  },
  'role-founder': roleAsset('founder'),
  'role-core': roleAsset('core'),
  'role-operations': roleAsset('operations'),
  'role-moderator': roleAsset('moderator'),
  'role-verified': roleAsset('verified'),
  'role-trial': roleAsset('trial'),
  'role-supporter': roleAsset('supporter'),
} as const satisfies Record<string, BrandAsset>;

export type BrandAssetId = keyof typeof BRAND_ASSETS;

export const BRAND_ASSET_IDS = Object.keys(BRAND_ASSETS) as BrandAssetId[];

export const BRAND_PACKAGE_NAME = '@jave/brand';

/**
 * Module id of a manifest file for bundlers and `require.resolve`, e.g.
 * `@jave/brand/assets/png/og-image-1200x630.png`. Only manifest paths are
 * accepted, so a caller can never reach outside the published asset tree.
 */
export function brandAssetModuleId(path: string): string {
  if (!brandAssetPaths().includes(path)) throw new RangeError(`Not a brand asset: ${path}`);
  return `${BRAND_PACKAGE_NAME}/${path}`;
}

/** Path of a specific raster; throws if the manifest has no such render. */
export function rasterPath(id: BrandAssetId, width: number): string {
  const raster = BRAND_ASSETS[id].rasters.find((r) => r.width === width);
  if (!raster) throw new RangeError(`No ${width}px render of ${id}.`);
  return raster.path;
}

/** Every file the manifest references (SVG sources and PNG renders). */
export function brandAssetPaths(): string[] {
  return BRAND_ASSET_IDS.flatMap((id) => [
    BRAND_ASSETS[id].svg,
    ...BRAND_ASSETS[id].rasters.map((r) => r.path),
  ]);
}

/** Where each asset goes. */
export const BRAND_TARGETS = {
  discord: {
    serverIcon: rasterPath('server-icon', 1024),
    serverBanner: rasterPath('server-banner', 960),
    inviteSplash: rasterPath('invite-splash', 1920),
    botAvatar: rasterPath('bot-avatar', 1024),
    roleIcons: {
      founder: rasterPath('role-founder', ROLE_ICON_SIZE),
      core: rasterPath('role-core', ROLE_ICON_SIZE),
      operations: rasterPath('role-operations', ROLE_ICON_SIZE),
      moderator: rasterPath('role-moderator', ROLE_ICON_SIZE),
      verified: rasterPath('role-verified', ROLE_ICON_SIZE),
      trial: rasterPath('role-trial', ROLE_ICON_SIZE),
      supporter: rasterPath('role-supporter', ROLE_ICON_SIZE),
    } satisfies Record<RoleIconKey, string>,
  },
  web: {
    faviconSvg: BRAND_ASSETS.favicon.svg,
    favicon32: rasterPath('favicon', 32),
    favicon16: rasterPath('favicon', 16),
    appleTouchIcon: rasterPath('apple-touch-icon', 180),
    ogImage: rasterPath('og-image', 1200),
  },
} as const;
