/**
 * The JAVELIN emblem: a slender faceted spear flanked by swept delta wings.
 * Symmetric, angular, legible down to 16px. Geometry is defined once here and
 * used by every rendering (React component, raster assets, Discord icons).
 *
 * Do not redesign — adjust only through this file.
 */
export const EMBLEM_VIEWBOX = '0 0 100 100';

/** Light (left) and shaded (right) facets, for two-tone metallic rendering. */
export const EMBLEM_FACETS = {
  spearLeft: 'M50 2 L50 98 L43.5 42 Z',
  spearRight: 'M50 2 L56.5 42 L50 98 Z',
  wingLeft: 'M42.2 50 L42.2 64 L10 92 Z',
  wingRight: 'M57.8 50 L90 92 L57.8 64 Z',
} as const;

/** Single-path silhouette for monochrome use (favicons, masks, role icons). */
export const EMBLEM_SILHOUETTE =
  'M50 2 L56.5 42 L50 98 L43.5 42 Z M42.2 50 L42.2 64 L10 92 Z M57.8 50 L90 92 L57.8 64 Z';

export const EMBLEM_LEFT_FACETS = [EMBLEM_FACETS.spearLeft, EMBLEM_FACETS.wingLeft] as const;
export const EMBLEM_RIGHT_FACETS = [EMBLEM_FACETS.spearRight, EMBLEM_FACETS.wingRight] as const;
