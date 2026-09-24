/**
 * Role visual language. Keys and treatments mirror @jave/core
 * (permissions/roles.ts); the dashboard test suite asserts they stay aligned.
 * Almost monochrome: only TRIAL and SUPPORTER carry a hue.
 */
export const ROLE_KEYS = [
  'founder',
  'core',
  'operations',
  'moderator',
  'verified',
  'trial',
  'applicant',
  'member',
  'supporter',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export type RoleTreatment =
  | 'holographic'
  | 'silver'
  | 'metallic'
  | 'steel'
  | 'white'
  | 'accent'
  | 'muted'
  | 'neutral'
  | 'special';

export interface RoleVisual {
  label: string;
  treatment: RoleTreatment;
  /** Tailwind utility implementing the treatment (see styles.css). */
  className: string;
}

/** Class names are spelled out in full so Tailwind can detect them. */
const TREATMENT_CLASS: Record<RoleTreatment, string> = {
  holographic: 'role-holographic',
  silver: 'role-silver',
  metallic: 'role-metallic',
  steel: 'role-steel',
  white: 'role-white',
  accent: 'role-accent',
  muted: 'role-muted',
  neutral: 'role-neutral',
  special: 'role-special',
};

const ROLE_TREATMENT: Record<RoleKey, { label: string; treatment: RoleTreatment }> = {
  founder: { label: 'Founder', treatment: 'holographic' },
  core: { label: 'Core', treatment: 'silver' },
  operations: { label: 'Operations', treatment: 'metallic' },
  moderator: { label: 'Moderator', treatment: 'steel' },
  verified: { label: 'Verified', treatment: 'white' },
  trial: { label: 'Trial', treatment: 'accent' },
  applicant: { label: 'Applicant', treatment: 'muted' },
  member: { label: 'Member', treatment: 'neutral' },
  supporter: { label: 'Supporter', treatment: 'special' },
};

export function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

export function roleVisual(role: RoleKey): RoleVisual {
  const entry = ROLE_TREATMENT[role];
  return { ...entry, className: TREATMENT_CLASS[entry.treatment] };
}

export function treatmentClass(treatment: RoleTreatment): string {
  return TREATMENT_CLASS[treatment];
}
