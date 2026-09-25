/**
 * JAVELIN design tokens — the TypeScript mirror of `styles.css`.
 *
 * `styles.css` is what the browser uses (Tailwind v4 `@theme`); this module is
 * for code that needs raw values (OG images, charts, e-mail, Discord embeds).
 * `tokens.test.ts` fails the build if the two drift apart.
 */

/** The six brand materials. Everything else derives from these. */
export const palette = {
  chrome: '#E8EAED',
  aluminium: '#B8BDC3',
  steel: '#737981',
  graphite: '#181A1D',
  black: '#08090A',
  white: '#FFFFFF',
} as const;

/** Role accents — the only chromatic colours in the identity. */
export const accents = {
  trial: '#9FB4C7',
  supporter: '#C9B98F',
} as const;

/** Cool neutral ramp, anchored on the palette (100 = chrome, 300 = aluminium, 500 = steel, 900 = graphite). */
export const neutral = {
  '0': '#FFFFFF',
  '50': '#F4F5F7',
  '100': '#E8EAED',
  '200': '#D3D6DA',
  '300': '#B8BDC3',
  '400': '#979CA3',
  '500': '#737981',
  '600': '#555A61',
  '700': '#3A3E44',
  '800': '#26292D',
  '900': '#181A1D',
  '950': '#0C0D0F',
  '1000': '#08090A',
} as const;

export type ThemeName = 'dark' | 'light';

/**
 * Semantic colour roles. Components use these, never raw hex.
 * Dark is the primary theme; light is a faithful inversion.
 */
export interface SemanticColors {
  canvas: string;
  surface: string;
  'surface-raised': string;
  'surface-sunken': string;
  'surface-overlay': string;
  'line-subtle': string;
  line: string;
  'line-strong': string;
  fg: string;
  'fg-muted': string;
  'fg-subtle': string;
  /** Icons, disabled text and decoration only — not legible body text. */
  'fg-faint': string;
  'fg-inverse': string;
  action: string;
  'action-hover': string;
  'action-fg': string;
  focus: string;
  success: string;
  warning: string;
  danger: string;
  'danger-solid': string;
  info: string;
  'accent-trial': string;
  'accent-supporter': string;
}

export const themes: Record<ThemeName, SemanticColors> = {
  dark: {
    canvas: '#08090A',
    surface: '#0E0F11',
    'surface-raised': '#141619',
    'surface-sunken': '#0A0B0C',
    'surface-overlay': '#121417',
    'line-subtle': '#16181B',
    line: '#202328',
    'line-strong': '#2C3035',
    fg: '#E8EAED',
    'fg-muted': '#B8BDC3',
    'fg-subtle': '#8B9097',
    'fg-faint': '#5E636A',
    'fg-inverse': '#08090A',
    action: '#E8EAED',
    'action-hover': '#FFFFFF',
    'action-fg': '#08090A',
    focus: '#A9BED3',
    success: '#7DBF9C',
    warning: '#D2B574',
    danger: '#E3868A',
    'danger-solid': '#B8444B',
    info: '#9DB3CB',
    'accent-trial': '#9FB4C7',
    'accent-supporter': '#C9B98F',
  },
  light: {
    canvas: '#F4F5F7',
    surface: '#FFFFFF',
    'surface-raised': '#FAFAFB',
    'surface-sunken': '#EEF0F2',
    'surface-overlay': '#FFFFFF',
    'line-subtle': '#E9EBEE',
    line: '#DCDFE3',
    'line-strong': '#C5CAD0',
    fg: '#0C0D0F',
    'fg-muted': '#3A3E44',
    'fg-subtle': '#5B6068',
    'fg-faint': '#9A9FA6',
    'fg-inverse': '#FFFFFF',
    action: '#181A1D',
    'action-hover': '#08090A',
    'action-fg': '#FFFFFF',
    focus: '#3C5E82',
    success: '#2F7552',
    warning: '#85621A',
    danger: '#A63A40',
    'danger-solid': '#A63A40',
    info: '#3C5E82',
    'accent-trial': '#4E6A85',
    'accent-supporter': '#77683F',
  },
};

/** Text roles that must reach WCAG AA (4.5:1) on every surface they sit on. */
export const LEGIBLE_TEXT_ROLES = [
  'fg',
  'fg-muted',
  'fg-subtle',
  'success',
  'warning',
  'danger',
  'info',
  'accent-trial',
  'accent-supporter',
] as const satisfies readonly (keyof SemanticColors)[];

/** Surfaces text is placed on. */
export const TEXT_SURFACES = [
  'canvas',
  'surface',
  'surface-raised',
  'surface-sunken',
  'surface-overlay',
] as const satisfies readonly (keyof SemanticColors)[];

export const fontFamilies = {
  /** Identity moments only: wordmark, uppercase page titles, rank letters, large numerals. */
  display: "'Orbitron Variable', 'Geist Variable', ui-sans-serif, sans-serif",
  /** All interface and body text. */
  sans: "'Geist Variable', ui-sans-serif, system-ui, sans-serif",
  /** Data: IDs, timestamps, codes, metrics. */
  mono: "'Geist Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

export const fontWeights = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

export interface TypeStyle {
  family: keyof typeof fontFamilies;
  sizePx: number;
  lineHeight: number;
  /** Letter spacing in em. */
  tracking: number;
  weight: number;
  uppercase: boolean;
}

/** The type scale. Orbitron (display family) is always uppercase with wide tracking. */
export const typeScale = {
  display: {
    family: 'display',
    sizePx: 40,
    lineHeight: 1.1,
    tracking: 0.14,
    weight: 600,
    uppercase: true,
  },
  title: {
    family: 'display',
    sizePx: 22,
    lineHeight: 1.25,
    tracking: 0.16,
    weight: 600,
    uppercase: true,
  },
  numeral: {
    family: 'display',
    sizePx: 30,
    lineHeight: 1.1,
    tracking: 0.04,
    weight: 500,
    uppercase: true,
  },
  heading: {
    family: 'sans',
    sizePx: 15,
    lineHeight: 1.45,
    tracking: -0.005,
    weight: 600,
    uppercase: false,
  },
  body: { family: 'sans', sizePx: 14, lineHeight: 1.6, tracking: 0, weight: 400, uppercase: false },
  small: {
    family: 'sans',
    sizePx: 13,
    lineHeight: 1.5,
    tracking: 0,
    weight: 400,
    uppercase: false,
  },
  micro: {
    family: 'mono',
    sizePx: 11,
    lineHeight: 1.45,
    tracking: 0.08,
    weight: 500,
    uppercase: true,
  },
} as const satisfies Record<string, TypeStyle>;

/** 4px base grid. Tailwind's default spacing scale (`p-1` = 4px) is kept for this reason. */
export const SPACING_BASE_PX = 4;
export const spacing = {
  '0': 0,
  '1': 4,
  '2': 8,
  '3': 12,
  '4': 16,
  '5': 20,
  '6': 24,
  '8': 32,
  '10': 40,
  '12': 48,
  '16': 64,
  '20': 80,
} as const;

/** One radius system: tight, machined corners. */
export const radii = {
  sm: '3px',
  md: '5px',
  lg: '8px',
  full: '9999px',
} as const;

/** Depth without glow: dark, short, low-opacity shadows plus a 1px top highlight. */
export const shadows = {
  sm: '0 1px 0 rgb(0 0 0 / 0.35)',
  md: '0 1px 2px rgb(0 0 0 / 0.35), 0 6px 16px -6px rgb(0 0 0 / 0.4)',
  lg: '0 2px 6px rgb(0 0 0 / 0.35), 0 18px 48px -12px rgb(0 0 0 / 0.55)',
  highlight: 'inset 0 1px 0 rgb(255 255 255 / 0.045)',
} as const;

export const motion = {
  durationFastMs: 120,
  durationBaseMs: 160,
  durationSlowMs: 260,
  easeStandard: 'cubic-bezier(0.2, 0, 0, 1)',
  easeExit: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

/** Stacking order. Popovers sit above modals so selects work inside dialogs. */
export const zIndex = {
  base: 0,
  sticky: 10,
  sidebar: 20,
  header: 30,
  overlay: 50,
  modal: 60,
  popover: 70,
  toast: 80,
  tooltip: 90,
} as const;

/** Icons: lucide-react, one stroke weight, three sizes. */
export const iconSizes = { sm: 14, md: 16, lg: 20 } as const;
export const ICON_STROKE_WIDTH = 1.5;
