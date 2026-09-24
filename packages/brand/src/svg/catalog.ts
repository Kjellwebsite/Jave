/**
 * One SVG builder per manifest entry. `scripts/render.ts` writes these to
 * `assets/svg` and rasterizes them; the tests rebuild them and compare with the
 * committed files, so an edit here without a re-render fails CI.
 */
import type { BrandAssetId } from '../manifest';
import { ROLE_ICON_KEYS, type RoleIconKey } from '../role-marks';
import {
  appleTouchIconSvg,
  botAvatarSvg,
  emblemMonoSvg,
  emblemOnLightSvg,
  emblemSvg,
  faviconSvg,
  serverIconSvg,
} from './icons';
import { horizontalLockupSvg, stackedLockupSvg, wordmarkSvg } from './lockups';
import { roleIconSvg } from './role-icons';
import { inviteSplashSvg, ogImageSvg, serverBannerSvg } from './scenes';
import type { BrandTypography } from './typography';

type RoleAssetId = `role-${RoleIconKey}`;

function roleIconBuilders(): Record<RoleAssetId, () => string> {
  return Object.fromEntries(
    ROLE_ICON_KEYS.map((key) => [`role-${key}`, () => roleIconSvg(key)]),
  ) as Record<RoleAssetId, () => string>;
}

/** Builds every brand SVG. Pure: the same typography always yields the same bytes. */
export function buildBrandSvgs(typography: BrandTypography): Record<BrandAssetId, string> {
  const builders: Record<BrandAssetId, () => string> = {
    emblem: emblemSvg,
    'emblem-on-light': emblemOnLightSvg,
    'emblem-mono': emblemMonoSvg,
    'server-icon': serverIconSvg,
    'bot-avatar': botAvatarSvg,
    favicon: faviconSvg,
    'apple-touch-icon': appleTouchIconSvg,
    wordmark: () => wordmarkSvg(typography, 'dark'),
    'wordmark-on-light': () => wordmarkSvg(typography, 'light'),
    'wordmark-mono': () => wordmarkSvg(typography, 'mono'),
    lockup: () => horizontalLockupSvg(typography, 'dark'),
    'lockup-on-light': () => horizontalLockupSvg(typography, 'light'),
    'lockup-stacked': () => stackedLockupSvg(typography, 'dark'),
    'lockup-stacked-on-light': () => stackedLockupSvg(typography, 'light'),
    'server-banner': () => serverBannerSvg(typography),
    'invite-splash': () => inviteSplashSvg(typography),
    'og-image': () => ogImageSvg(typography),
    ...roleIconBuilders(),
  };
  const built = Object.entries(builders).map(([id, build]) => [id, build()] as const);
  return Object.fromEntries(built) as Record<BrandAssetId, string>;
}
