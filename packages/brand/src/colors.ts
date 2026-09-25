/**
 * JAVELIN palette. Near-monochrome by design — precision, aerospace, machined
 * metal. No neon, no purple, no glow.
 */
export const BRAND_COLORS = {
  chrome: '#E8EAED',
  aluminium: '#B8BDC3',
  steel: '#737981',
  graphite: '#181A1D',
  black: '#08090A',
  white: '#FFFFFF',
} as const;

export type BrandColorName = keyof typeof BRAND_COLORS;

/** The only chromatic accents in the system, each reserved for one role. */
export const BRAND_ACCENTS = {
  trial: '#9FB4C7',
  supporter: '#C9B98F',
} as const;

export type BrandAccentName = keyof typeof BRAND_ACCENTS;

/**
 * Intermediate tones used to render metal: steps on the aluminium, steel and
 * graphite ramps between palette colours, two faint founder tints, and a light
 * and deep step of each accent. Assets may use nothing outside the palette and
 * these tones (tested).
 */
export const METAL_TONES = {
  /** Aluminium ramp, light to deep. */
  aluminiumHighlight: '#F7F8F9',
  aluminiumLight: '#DDE0E4',
  aluminiumLow: '#9CA2A9',
  aluminiumDeep: '#848A92',
  /**
   * Brushed face of the server icon: mid silver, dark enough that a white
   * facet still stands off it when the icon is reduced to 16 px.
   */
  aluminiumFaceTop: '#C4C9CE',
  aluminiumFaceMid: '#AEB4BA',
  aluminiumFaceLow: '#959BA2',
  /** Steel and graphite ramp for dark surfaces and on-light marks. */
  steelDeep: '#4E545B',
  gunmetal: '#3A3E44',
  graphiteLift: '#2A2D32',
  graphiteMid: '#202226',
  graphiteDeep: '#111214',
  /** Faint cool and warm tints for the founder mark's restrained iridescence. */
  iceTint: '#DCE6EC',
  champagneTint: '#ECE6D9',
  /** Accent ramps. */
  trialLight: '#C3D1DD',
  trialDeep: '#72889B',
  supporterLight: '#E3D8BA',
  supporterDeep: '#9A8A62',
} as const;
