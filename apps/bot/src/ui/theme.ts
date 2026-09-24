/**
 * JAVE's Discord visual language: near-monochrome, precise, calm.
 * Colours mirror the JAVELIN palette (see docs/DESIGN.md).
 */
export const COLORS = {
  /** Default accent: aluminium. */
  base: 0xb8bdc3,
  chrome: 0xe8eaed,
  steel: 0x737981,
  graphite: 0x181a1d,
  success: 0x7fa88c,
  warning: 0xc9a45c,
  danger: 0xb86b6b,
  info: 0x8fa3b8,
} as const;

export const GLYPH = {
  verified: '✓',
  claimed: '◇',
  unknown: '—',
  bullet: '▸',
  dot: '·',
  cross: '✕',
  arrow: '→',
  bar: '│',
} as const;

export const BRAND = {
  organization: 'JAVELIN',
  bot: 'JAVE',
  motto: 'YOU THINK YOU’RE ELITE? PROVE IT.',
} as const;

/** Discord limits we render against. */
export const LIMITS = {
  embedTitle: 256,
  embedDescription: 4096,
  fieldName: 256,
  fieldValue: 1024,
  fields: 25,
  content: 2000,
  buttonLabel: 80,
  selectOptions: 25,
  autocompleteChoices: 25,
  modalTitle: 45,
} as const;
