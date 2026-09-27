import { formBoolean, formOptional, formString } from './form-data';
import {
  RARITY_LABELS,
  type RarityKey,
  VISIBILITY_LABELS,
  type VisibilityKey,
} from './achievement-labels';

/**
 * Form → service input for achievement definitions (the criteria builder).
 * Pure; the achievements service validates every field and the rule itself.
 */

export type CriteriaInput =
  { type: 'manual' } | { type: 'event_count'; event: string; threshold: number };

/** The rule from the builder: manual, or "count this event N times". */
export function criteriaFrom(data: FormData): CriteriaInput {
  if (formString(data, 'ruleType') !== 'event_count') return { type: 'manual' };
  return {
    type: 'event_count',
    event: formString(data, 'event'),
    threshold: Number(formOptional(data, 'threshold') ?? Number.NaN),
  };
}

function oneOf<T extends string>(labels: Record<T, string>, value: string, fallback: T): T {
  return Object.hasOwn(labels, value) ? (value as T) : fallback;
}

export interface DefinitionFields {
  title: string;
  summary: string;
  description: string;
  category: string;
  rarity: RarityKey;
  visibility: VisibilityKey;
  criteria: CriteriaInput;
  requiresVerification: boolean;
  facetKey: string | null;
  active: boolean;
  ordinal: number;
}

export function definitionFields(data: FormData): DefinitionFields {
  return {
    title: formString(data, 'title'),
    summary: formString(data, 'summary'),
    description: formString(data, 'description'),
    category: formString(data, 'category'),
    rarity: oneOf(RARITY_LABELS, formString(data, 'rarity'), 'standard'),
    visibility: oneOf(VISIBILITY_LABELS, formString(data, 'visibility'), 'public'),
    criteria: criteriaFrom(data),
    requiresVerification: formBoolean(data, 'requiresVerification'),
    facetKey: formOptional(data, 'facetKey') ?? null,
    active: formBoolean(data, 'active'),
    ordinal: Number(formOptional(data, 'ordinal') ?? 0),
  };
}

/** Field names the definition schema reports on, for inline errors. */
export const DEFINITION_FORM_FIELDS = [
  'key',
  'title',
  'summary',
  'description',
  'category',
  'criteria.event',
  'criteria.threshold',
  'criteria',
  'facetKey',
  'ordinal',
] as const;

/** Member reference typed by staff: "@mara", "mara" or a pasted "Mara". */
export function handleFrom(data: FormData): string {
  return formString(data, 'handle').trim().replace(/^@/, '').toLowerCase();
}
