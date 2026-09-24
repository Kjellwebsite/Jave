/**
 * @jave/brand — the JAVELIN brand kit.
 *
 * Runtime-safe exports only (no Node APIs, no font or rasterizer code), so any
 * app — the bot, the Next.js dashboard, the Activity — can import from here.
 * Asset files are published as `@jave/brand/assets/…` (see `BRAND_ASSETS`).
 */
export * from './emblem';
export {
  EMBLEM_AXIS_X,
  EMBLEM_BOUNDS,
  EMBLEM_ENCLOSING_CIRCLE,
  EMBLEM_POLYGONS,
  EMBLEM_UNITS,
} from './emblem-metrics';
export type { Bounds, Circle, Point, Polygon } from './geometry';
export {
  BRAND_ACCENTS,
  BRAND_COLORS,
  METAL_TONES,
  type BrandAccentName,
  type BrandColorName,
} from './colors';
export { BRAND_MOTTO, BRAND_NAME } from './copy';
export {
  BRAND_ASSETS,
  BRAND_ASSET_IDS,
  BRAND_PACKAGE_NAME,
  BRAND_TARGETS,
  brandAssetModuleId,
  brandAssetPaths,
  rasterPath,
  type BrandAsset,
  type BrandAssetId,
  type BrandRaster,
} from './manifest';
export { ROLE_ICON_KEYS, ROLE_MARKS, type RoleIconKey, type RoleMark } from './role-marks';
