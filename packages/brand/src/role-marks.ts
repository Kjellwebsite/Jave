/**
 * Role marks for Discord role icons. Each is a simple faceted shape in the
 * emblem's language — vertical symmetry, a lit left facet and a shaded right
 * facet, hard angles — drawn bold enough to survive a 16px render.
 *
 * Coordinates are on a 64-unit grid (the Discord role icon size).
 */
export const ROLE_MARK_UNITS = 64;

export const ROLE_ICON_KEYS = [
  'founder',
  'core',
  'operations',
  'moderator',
  'verified',
  'trial',
  'supporter',
] as const;

export type RoleIconKey = (typeof ROLE_ICON_KEYS)[number];

export interface RoleMark {
  readonly label: string;
  /** What the shape stands for, in one line. */
  readonly concept: string;
  /** Facets facing the light (top-left). */
  readonly lightFacets: readonly string[];
  /** Facets turned away from the light. */
  readonly shadeFacets: readonly string[];
  /** Facets drawn only as a translucent tint with an outline (unproven). */
  readonly openFacets: readonly string[];
  /** A contrasting shape inlaid on top of the facets. */
  readonly inlay: string | null;
}

export const ROLE_MARKS: Readonly<Record<RoleIconKey, RoleMark>> = {
  founder: {
    label: 'Founder',
    concept: 'The full emblem, spear and wings, cut heavier to hold at 16px.',
    lightFacets: ['M32 2 L32 62 L24 27 Z', 'M21 32 L21 46 L3 60 Z'],
    shadeFacets: ['M32 2 L40 27 L32 62 Z', 'M43 32 L61 60 L43 46 Z'],
    openFacets: [],
    inlay: null,
  },
  core: {
    label: 'Core',
    concept: 'The spear alone, widened into a spearhead — the core of the emblem.',
    lightFacets: ['M32 2 L32 62 L20 27 Z'],
    shadeFacets: ['M32 2 L44 27 L32 62 Z'],
    openFacets: [],
    inlay: null,
  },
  operations: {
    label: 'Operations',
    concept: 'A delta wing — the airframe that carries the mission.',
    lightFacets: ['M32 4 L32 45 L3 59 Z'],
    shadeFacets: ['M32 4 L61 59 L32 45 Z'],
    openFacets: [],
    inlay: null,
  },
  moderator: {
    label: 'Moderator',
    concept: 'A shield with the spear inlaid — the guard.',
    lightFacets: ['M32 3 L32 61 L8 36 L8 11 Z'],
    shadeFacets: ['M32 3 L56 11 L56 36 L32 61 Z'],
    openFacets: [],
    inlay: 'M32 12 L37 30 L32 51 L27 30 Z',
  },
  verified: {
    label: 'Verified',
    concept: 'A machined check — capability confirmed.',
    lightFacets: ['M4 34 L12 26 L24 38 L24 54 Z'],
    shadeFacets: ['M24 38 L52 10 L60 18 L24 54 Z'],
    openFacets: [],
    inlay: null,
  },
  trial: {
    label: 'Trial',
    concept: 'A diamond half proven — one facet solid, one still open.',
    lightFacets: ['M32 4 L32 60 L4 32 Z'],
    shadeFacets: [],
    openFacets: ['M32 4 L60 32 L32 60 Z'],
    inlay: null,
  },
  supporter: {
    label: 'Supporter',
    concept: 'A four-point star — a signal that JAVELIN is backed.',
    lightFacets: [
      'M32 2 L25 25 L32 32 Z',
      'M62 32 L39 25 L32 32 Z',
      'M32 62 L25 39 L32 32 Z',
      'M2 32 L25 25 L32 32 Z',
    ],
    shadeFacets: [
      'M32 2 L39 25 L32 32 Z',
      'M62 32 L39 39 L32 32 Z',
      'M32 62 L39 39 L32 32 Z',
      'M2 32 L25 39 L32 32 Z',
    ],
    openFacets: [],
    inlay: null,
  },
};

/** Every facet of a mark, for silhouettes, outlines and measurements. */
export function roleMarkFacets(mark: RoleMark): string[] {
  return [
    ...mark.lightFacets,
    ...mark.shadeFacets,
    ...mark.openFacets,
    ...(mark.inlay ? [mark.inlay] : []),
  ];
}
